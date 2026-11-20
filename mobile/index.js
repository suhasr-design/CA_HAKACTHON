// Must load before ethers: provides crypto.getRandomValues on React Native.
import "react-native-get-random-values";
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
