// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IAnonAadhaar} from "./interfaces/IAnonAadhaar.sol";

/// @title FairTicketsBase: all event rules except the source of randomness.
/// @notice Concrete contracts plug in the randomness:
///   - FairTickets              -> Chainlink VRF v2.5 (local demo with a mock coordinator)
///   - FairTicketsCommitReveal  -> organiser commit-reveal + future block hash (Quai Orchard)
/// Mechanisms:
///  1. Inventory commitment: the organiser locks a Merkle root of all seats before the sale.
///  2. One human, one entry: registration needs an Anon Aadhaar zero-knowledge proof; each
///     nullifier (anonymous per-person, per-event ID) can register only once.
///  3. Verifiable lottery: after registration closes, a random seed is set and anyone can run
///     the on-chain Fisher–Yates shuffle. First `publicSeats` entrants win; the rest form the
///     waitlist, in order.
///  4. Non-transferable tickets: tickets can be minted and burned, never transferred.
///  5. Buyback + waitlist: a holder can only sell back to the contract at face value. The seat
///     is offered to the next waitlisted fan; on acceptance the old ticket is burned and a new
///     one is minted.
///  6. Public ticket check: `ticketStatus` lets anyone check any ticket.
abstract contract FairTicketsBase is ERC721, Ownable, ReentrancyGuard {
    // ------------------------------------------------------------------ types

    enum Phase { Setup, Registration, Drawing, Shuffling, Sale }
    enum TicketStatus { NotFound, Valid, BeingReturned, Replaced }

    struct Offer {
        address fan;       // waitlisted fan the seat is offered to
        uint64 deadline;   // offer expires after this time
        address seller;    // fan who sold back (address(0) = unclaimed seat, proceeds go to organiser)
        uint256 tokenId;   // ticket being returned (0 for unclaimed seats)
        bool active;
    }

    // ------------------------------------------------------------- immutables

    string public eventName;
    uint256 public immutable facePrice;
    uint32 public immutable offerWindow;   // seconds a waitlisted fan has to accept
    uint32 public immutable claimWindow;   // seconds a lottery winner has to pay
    IAnonAadhaar public immutable anonAadhaar;
    uint256 public immutable nullifierSeed;

    // ------------------------------------------------------------------ state

    Phase public phase;

    // Inventory commitment
    bytes32 public inventoryRoot;
    uint32 public publicSeats;
    uint32 public sponsorSeats;
    uint32 public holdSeats;
    mapping(uint256 => string) public seatLabel;
    mapping(uint256 => bool) public seatRevealed;

    // Registration
    uint64 public registrationClosesAt;
    address[] internal _entrants;
    mapping(uint256 => bool) public nullifierUsed;
    mapping(address => bool) public isRegistered;

    // Lottery
    uint256 public randomSeed;
    uint256 public shuffledUpTo;
    // Final shuffled position + 1 (0 = not drawn yet), written as the shuffle fixes each slot,
    // so positionOf is O(1) even with lakhs of entrants.
    mapping(address => uint256) private _positionPlusOne;

    // Sale, buyback and waitlist
    uint64 public claimDeadline;
    uint64 public buybackDeadline;
    uint256 public nextWaitlistIndex;
    uint256 public nextTokenId = 1;
    mapping(uint256 => bool) public seatIssued;     // seat currently has a live ticket
    mapping(uint256 => uint256) public seatToken;   // seat => live tokenId
    mapping(uint256 => uint256) public tokenSeat;   // tokenId => seat
    mapping(uint256 => bool) public tokenReplaced;  // burned after buyback
    mapping(uint256 => bool) public tokenLocked;    // being returned
    mapping(address => bool) public hasTicket;
    mapping(uint256 => Offer) public offers;        // seat => current offer
    uint256 public organiserBalance;
    mapping(address => uint256) public pendingRefunds;

    // Gate audit trail
    bytes32[] public scanLogs;

    // ----------------------------------------------------------------- events

    event InventoryCommitted(bytes32 root, uint32 publicSeats, uint32 sponsorSeats, uint32 holdSeats);
    event RegistrationOpened(uint64 closesAt, uint64 buybackDeadline);
    event Registered(address indexed fan, uint256 indexed nullifier, uint256 entryNumber);
    event RandomnessReceived(uint256 seed);
    event ShuffleProgress(uint256 shuffledUpTo, uint256 total);
    event SaleOpened(uint64 claimDeadline);
    event SeatRevealed(uint256 indexed seat, string label);
    event TicketIssued(uint256 indexed tokenId, address indexed holder, uint256 indexed seat);
    event SellBackRequested(uint256 indexed tokenId, address indexed seller, uint256 indexed seat);
    event SeatOffered(uint256 indexed seat, address indexed fan, uint64 deadline);
    event OfferAccepted(uint256 indexed seat, address indexed fan, uint256 newTokenId, uint256 oldTokenId);
    event WaitlistExhausted(uint256 indexed seat);
    event ScanLogSubmitted(bytes32 logHash, uint32 scanned);

    // ----------------------------------------------------------------- errors

    error WrongPhase(Phase expected, Phase actual);
    error NonTransferable();

    modifier inPhase(Phase p) {
        if (phase != p) revert WrongPhase(p, phase);
        _;
    }

    constructor(
        string memory _eventName,
        uint256 _facePrice,
        uint32 _offerWindow,
        uint32 _claimWindow,
        address _anonAadhaar,
        uint256 _nullifierSeed
    ) ERC721("Fair Ticket", "FAIR") Ownable(msg.sender) {
        eventName = _eventName;
        facePrice = _facePrice;
        offerWindow = _offerWindow;
        claimWindow = _claimWindow;
        anonAadhaar = IAnonAadhaar(_anonAadhaar);
        nullifierSeed = _nullifierSeed;
    }

    /// @dev Hook for randomness sources that need setup before registration opens.
    function _beforeOpenRegistration() internal virtual {}

    // ====================================================== 1. Inventory

    /// @notice Lock the seat inventory before the sale. Can only be done once.
    function commitInventory(bytes32 root, uint32 _publicSeats, uint32 _sponsorSeats, uint32 _holdSeats)
        external
        onlyOwner
        inPhase(Phase.Setup)
    {
        require(inventoryRoot == bytes32(0), "Already committed");
        require(root != bytes32(0) && _publicSeats > 0, "Bad inventory");
        inventoryRoot = root;
        publicSeats = _publicSeats;
        sponsorSeats = _sponsorSeats;
        holdSeats = _holdSeats;
        emit InventoryCommitted(root, _publicSeats, _sponsorSeats, _holdSeats);
    }

    /// @notice Prove public seats belong to the committed inventory. Anyone can call this.
    /// Leaves follow OpenZeppelin's StandardMerkleTree: keccak256(keccak256(abi.encode(index, label, category, salt))).
    function revealSeats(
        uint256[] calldata indexes,
        string[] calldata labels,
        bytes32[] calldata salts,
        bytes32[][] calldata proofs
    ) external {
        require(inventoryRoot != bytes32(0), "No inventory");
        require(indexes.length == labels.length && labels.length == salts.length && salts.length == proofs.length, "Length mismatch");
        for (uint256 i = 0; i < indexes.length; i++) {
            uint256 idx = indexes[i];
            require(idx < publicSeats, "Not a public seat");
            if (seatRevealed[idx]) continue;
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(idx, labels[i], "public", salts[i]))));
            require(MerkleProof.verifyCalldata(proofs[i], inventoryRoot, leaf), "Seat not in committed inventory");
            seatRevealed[idx] = true;
            seatLabel[idx] = labels[i];
            emit SeatRevealed(idx, labels[i]);
        }
    }

    // ====================================================== 2. Registration

    function openRegistration(uint64 closesAt, uint64 _buybackDeadline) external onlyOwner inPhase(Phase.Setup) {
        require(inventoryRoot != bytes32(0), "Commit inventory first");
        require(closesAt > block.timestamp && _buybackDeadline > closesAt, "Bad times");
        _beforeOpenRegistration();
        registrationClosesAt = closesAt;
        buybackDeadline = _buybackDeadline;
        phase = Phase.Registration;
        emit RegistrationOpened(closesAt, _buybackDeadline);
    }

    /// @notice Register for the lottery with an Anon Aadhaar proof.
    /// The proof's signal must be the caller's address, so a copied proof is useless to anyone else.
    function register(
        uint256 nullifier,
        uint256 timestamp,
        uint256[4] calldata revealArray,
        uint256[8] calldata groth16Proof
    ) external inPhase(Phase.Registration) {
        require(block.timestamp < registrationClosesAt, "Registration closed");
        require(!nullifierUsed[nullifier], "This person is already registered");
        require(!isRegistered[msg.sender], "Wallet already registered");
        uint256 signal = uint256(uint160(msg.sender));
        // The Groth16 verifier can revert on malformed points; treat any failure as an invalid proof.
        bool valid;
        try anonAadhaar.verifyAnonAadhaarProof(nullifierSeed, nullifier, timestamp, signal, revealArray, groth16Proof)
            returns (bool ok)
        {
            valid = ok;
        } catch {
            valid = false;
        }
        require(valid, "Invalid Anon Aadhaar proof");
        nullifierUsed[nullifier] = true;
        isRegistered[msg.sender] = true;
        _entrants.push(msg.sender);
        emit Registered(msg.sender, nullifier, _entrants.length);
    }

    // ====================================================== 3. Lottery

    /// @dev Registration has closed: freeze the entrant list and move to Drawing.
    /// The random seed is only obtained AFTER this, so nobody can time their entry.
    function _beginDrawing() internal {
        if (phase != Phase.Registration) revert WrongPhase(Phase.Registration, phase);
        require(block.timestamp >= registrationClosesAt, "Registration still open");
        phase = Phase.Drawing;
    }

    /// @dev Called by the randomness source once the seed is known.
    function _setSeed(uint256 seed) internal {
        if (phase != Phase.Drawing) revert WrongPhase(Phase.Drawing, phase);
        randomSeed = seed;
        phase = Phase.Shuffling;
        emit RandomnessReceived(seed);
        if (_entrants.length <= 1) {
            if (_entrants.length == 1) _positionPlusOne[_entrants[0]] = 1;
            _openSale();
        }
    }

    /// @notice Run `steps` steps of the Fisher–Yates shuffle. Anyone can call; batched for large events.
    function runShuffle(uint256 steps) external inPhase(Phase.Shuffling) {
        uint256 n = _entrants.length;
        uint256 i = shuffledUpTo;
        uint256 end = i + steps;
        if (end > n - 1) end = n - 1;
        for (; i < end; i++) {
            uint256 j = i + (uint256(keccak256(abi.encode(randomSeed, i))) % (n - i));
            address picked = _entrants[j];
            if (j != i) (_entrants[i], _entrants[j]) = (picked, _entrants[i]);
            _positionPlusOne[picked] = i + 1; // slot i is now final
        }
        shuffledUpTo = i;
        emit ShuffleProgress(i, n);
        if (i >= n - 1) {
            _positionPlusOne[_entrants[n - 1]] = n; // the last slot is fixed by elimination
            _openSale();
        }
    }

    function _openSale() internal {
        phase = Phase.Sale;
        claimDeadline = uint64(block.timestamp) + claimWindow;
        nextWaitlistIndex = _winnerCount();
        emit SaleOpened(claimDeadline);
    }

    function _winnerCount() internal view returns (uint256) {
        return _entrants.length < publicSeats ? _entrants.length : publicSeats;
    }

    // ====================================================== 4. Claiming tickets

    /// @notice A lottery winner pays face value to receive the ticket for their seat.
    /// @param position The winner's position in the shuffled list (see `positionOf`).
    function claimTicket(uint256 position) external payable nonReentrant inPhase(Phase.Sale) {
        require(block.timestamp <= claimDeadline, "Claim window closed");
        require(position < _winnerCount(), "Not a winning position");
        require(_entrants[position] == msg.sender, "Not your position");
        require(!seatIssued[position] && !offers[position].active, "Seat already handled");
        require(seatRevealed[position], "Seat not yet revealed");
        require(msg.value == facePrice, "Pay exactly face value");
        organiserBalance += msg.value;
        _issue(msg.sender, position);
    }

    function _issue(address to, uint256 seat) internal returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        seatIssued[seat] = true;
        seatToken[seat] = tokenId;
        tokenSeat[tokenId] = seat;
        hasTicket[to] = true;
        _mint(to, tokenId);
        emit TicketIssued(tokenId, to, seat);
    }

    /// @notice After the claim window, unclaimed winning seats go to the waitlist. Anyone can call.
    function releaseUnclaimed(uint256 position) external inPhase(Phase.Sale) {
        require(block.timestamp > claimDeadline, "Claim window still open");
        require(position < _winnerCount(), "Not a winning position");
        require(!seatIssued[position] && !offers[position].active, "Seat already handled");
        require(seatRevealed[position], "Seat not yet revealed");
        _offerToNext(position, address(0), 0);
    }

    // ====================================================== 5. Buyback and waitlist

    /// @notice Return your ticket. You are refunded face value when the next fan takes the seat.
    function sellBack(uint256 tokenId) external inPhase(Phase.Sale) {
        require(ownerOf(tokenId) == msg.sender, "Not your ticket");
        require(block.timestamp < buybackDeadline, "Buyback closed");
        require(!tokenLocked[tokenId], "Already being returned");
        tokenLocked[tokenId] = true;
        uint256 seat = tokenSeat[tokenId];
        emit SellBackRequested(tokenId, msg.sender, seat);
        _offerToNext(seat, msg.sender, tokenId);
    }

    /// @notice A waitlisted fan accepts an offered seat by paying face value.
    function acceptOffer(uint256 seat) external payable nonReentrant inPhase(Phase.Sale) {
        Offer memory o = offers[seat];
        require(o.active, "No active offer");
        require(msg.sender == o.fan, "Not your offer");
        require(block.timestamp <= o.deadline, "Offer expired");
        require(block.timestamp < buybackDeadline, "Sales closed");
        require(!hasTicket[msg.sender], "You already have a ticket");
        require(msg.value == facePrice, "Pay exactly face value");
        delete offers[seat];

        if (o.seller != address(0)) {
            // Returned ticket: burn it and refund the seller (pull payment).
            tokenReplaced[o.tokenId] = true;
            tokenLocked[o.tokenId] = false;
            hasTicket[o.seller] = false;
            _burn(o.tokenId);
            pendingRefunds[o.seller] += msg.value;
        } else {
            organiserBalance += msg.value;
        }
        uint256 newTokenId = _issue(msg.sender, seat);
        emit OfferAccepted(seat, msg.sender, newTokenId, o.tokenId);
    }

    /// @notice Move an expired offer on to the next waitlisted fan. Anyone can call.
    function expireOffer(uint256 seat) external inPhase(Phase.Sale) {
        Offer memory o = offers[seat];
        require(o.active, "No active offer");
        require(block.timestamp > o.deadline, "Offer still active");
        _offerToNext(seat, o.seller, o.tokenId);
    }

    function _offerToNext(uint256 seat, address seller, uint256 tokenId) internal {
        uint256 n = _entrants.length;
        while (nextWaitlistIndex < n) {
            address fan = _entrants[nextWaitlistIndex++];
            if (!hasTicket[fan]) {
                uint64 deadline = uint64(block.timestamp) + offerWindow;
                offers[seat] = Offer({fan: fan, deadline: deadline, seller: seller, tokenId: tokenId, active: true});
                emit SeatOffered(seat, fan, deadline);
                return;
            }
        }
        // Waitlist exhausted: the seller keeps their ticket.
        delete offers[seat];
        if (seller != address(0)) tokenLocked[tokenId] = false;
        emit WaitlistExhausted(seat);
    }

    function withdrawRefund() external nonReentrant {
        uint256 amount = pendingRefunds[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingRefunds[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
    }

    function withdrawProceeds() external onlyOwner nonReentrant {
        uint256 amount = organiserBalance;
        organiserBalance = 0;
        (bool ok, ) = payable(owner()).call{value: amount}("");
        require(ok, "Transfer failed");
    }

    // ====================================================== Gate audit

    function submitScanLog(bytes32 logHash, uint32 scanned) external onlyOwner {
        scanLogs.push(logHash);
        emit ScanLogSubmitted(logHash, scanned);
    }

    // ====================================================== 6. Public views

    function ticketStatus(uint256 tokenId) public view returns (TicketStatus) {
        if (tokenId == 0 || tokenId >= nextTokenId) return TicketStatus.NotFound;
        if (tokenReplaced[tokenId]) return TicketStatus.Replaced;
        if (tokenLocked[tokenId]) return TicketStatus.BeingReturned;
        return TicketStatus.Valid;
    }

    /// @notice Everything the public ticket checker needs in one call.
    function checkTicket(uint256 tokenId)
        external
        view
        returns (TicketStatus status, address holder, uint256 seat, string memory label)
    {
        status = ticketStatus(tokenId);
        if (status == TicketStatus.NotFound) return (status, address(0), 0, "");
        seat = tokenSeat[tokenId];
        label = seatLabel[seat];
        if (status != TicketStatus.Replaced) holder = ownerOf(tokenId);
    }

    function entrantsCount() external view returns (uint256) {
        return _entrants.length;
    }

    function entrantAt(uint256 i) external view returns (address) {
        return _entrants[i];
    }

    function getEntrants() external view returns (address[] memory) {
        return _entrants;
    }

    function winnerCount() external view returns (uint256) {
        return _winnerCount();
    }

    /// @notice Final position of `fan` in the shuffled list (0 = first winner), or type(uint256).max
    /// if they didn't register or their slot hasn't been drawn yet. O(1) at any event size.
    function positionOf(address fan) external view returns (uint256) {
        uint256 p = _positionPlusOne[fan];
        return p == 0 ? type(uint256).max : p - 1;
    }

    /// @notice A page of the entrant list (shuffled order once drawn), for large events.
    function getEntrantsPage(uint256 start, uint256 count) external view returns (address[] memory page) {
        uint256 n = _entrants.length;
        if (start >= n) return new address[](0);
        uint256 end = start + count > n ? n : start + count;
        page = new address[](end - start);
        for (uint256 i = start; i < end; i++) page[i - start] = _entrants[i];
    }

    /// @notice Live tickets with ids in [fromId, fromId + count): gate scanners sync in pages.
    function getLiveTicketsPage(uint256 fromId, uint256 count)
        external
        view
        returns (uint256[] memory ids, address[] memory holders, uint256[] memory seats)
    {
        if (fromId == 0) fromId = 1;
        uint256 end = fromId + count > nextTokenId ? nextTokenId : fromId + count;
        uint256 n;
        for (uint256 t = fromId; t < end; t++) if (ticketStatus(t) == TicketStatus.Valid) n++;
        ids = new uint256[](n);
        holders = new address[](n);
        seats = new uint256[](n);
        uint256 k;
        for (uint256 t = fromId; t < end; t++) {
            if (ticketStatus(t) == TicketStatus.Valid) {
                (ids[k], holders[k], seats[k]) = (t, ownerOf(t), tokenSeat[t]);
                k++;
            }
        }
    }

    /// @notice All live tickets — fine for small events; large events use getLiveTicketsPage.
    function getLiveTickets()
        external
        view
        returns (uint256[] memory ids, address[] memory holders, uint256[] memory seats)
    {
        uint256 count;
        for (uint256 t = 1; t < nextTokenId; t++) if (ticketStatus(t) == TicketStatus.Valid) count++;
        ids = new uint256[](count);
        holders = new address[](count);
        seats = new uint256[](count);
        uint256 k;
        for (uint256 t = 1; t < nextTokenId; t++) {
            if (ticketStatus(t) == TicketStatus.Valid) {
                ids[k] = t;
                holders[k] = ownerOf(t);
                seats[k] = tokenSeat[t];
                k++;
            }
        }
    }

    function scanLogCount() external view returns (uint256) {
        return scanLogs.length;
    }

    // ====================================================== Non-transferable

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert NonTransferable();
        return super._update(to, tokenId, auth);
    }
}
