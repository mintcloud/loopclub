// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract MockUsdm is ERC20, ERC20Permit {
    uint256 public constant FAUCET_AMOUNT = 1_000e18;

    constructor() ERC20("Mock USDm", "USDm") ERC20Permit("Mock USDm") {}

    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
