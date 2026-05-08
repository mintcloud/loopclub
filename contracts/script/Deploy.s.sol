// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {MockUsdm} from "../src/MockUsdm.sol";
import {Loopchain} from "../src/Loopchain.sol";

/// @notice Deploys MockUsdm (testnet only if PAYMENT_TOKEN env var is unset) and Loopchain.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", deployer);

        vm.startBroadcast(pk);

        // 1. Resolve payment token. If PAYMENT_TOKEN env is set, reuse it.
        //    Otherwise (testnet path), deploy a new MockUsdm.
        address payment;
        try vm.envAddress("PAYMENT_TOKEN") returns (address existing) {
            payment = existing;
            console2.log("Using existing payment token at:", payment);
        } catch {
            MockUsdm usdm = new MockUsdm();
            payment = address(usdm);
            console2.log("Deployed MockUsdm at:", payment);
        }

        // 2. Deploy Loopchain.
        Loopchain lc = new Loopchain(payment, treasury, deployer);
        console2.log("Deployed Loopchain at:", address(lc));
        console2.log("Owner / treasury:", deployer, "/", treasury);

        vm.stopBroadcast();
    }
}
