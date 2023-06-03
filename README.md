<span align="center">

<a href="https://github.com/homebridge/verified/blob/master/verified-plugins.json"><img alt="homebridge-verified" src="https://raw.githubusercontent.com/donavanbecker/homebridge-rainbird/latest/rainbird/Homebridge_x_Rainbird.svg?sanitize=true" width="500px"></a>

# Homebridge Rainbird

<a href="https://www.npmjs.com/package/homebridge-rainbird"><img title="npm version" src="https://badgen.net/npm/v/homebridge-rainbird?icon=npm&label" ></a>
<a href="https://www.npmjs.com/package/homebridge-rainbird"><img title="npm downloads" src="https://badgen.net/npm/dt/homebridge-rainbird?label=downloads" ></a>
<a href="https://discord.gg/8fpZA4S"><img title="discord-rainbird" src="https://badgen.net/discord/online-members/8fpZA4S?icon=discord&label=discord" ></a>

<a href="https://paypal.me/donavanbecker"><img title="donavanbecker" src="https://badgen.net/badge/donavanbecker/paypal/yellow" ></a>
<a href="https://paypal.me/Mantorok1"><img title="mantorok1" src="https://badgen.net/badge/mantorok1/paypal/yellow" ></a>

<p>The Homebridge <a href="https://rainbird.com">RainBird</a> 
plugin allows you to access your RainBird Controller from HomeKit with
  <a href="https://homebridge.io">Homebridge</a>. 
</p>

</span>

## Installation

1. Search for "Rainbird" on the plugin screen of [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x).
2. Click **Install**.

## Configuration

1. Set a Static IP Address to your [RainBird](https://www.rainbird.com) Controller - [How to Set Static IP Address](https://www.howtogeek.com/184310/ask-htg-should-i-be-setting-static-ip-addresses-on-my-router/).
2. Input Static IP Address and Password for [RainBird](https://www.rainbird.com) Controller into Plugin UI Settings and restart Homebridge.
    - If you choose to create child bridge with this plugin, do it at this time.
    - Password is the password you used to setup the rainbird controller.

## Collaborators

 - [mantorok1](https://github.com/mantorok1)
    - ##### Thanks for all your help!

## Compatiable Controllers

Any controller that supports the [RainBird LNK WiFi Module](https://www.rainbird.com/products/lnk-wifi-module) should be compatible. This includes:
- ESP-Me
- ESP-TM2
- ESP-RZXe
- ESP-ME3

## Known Limitations
- Using the RainBird app while the plugin is running can cause connectivity issues.
- The RainBird LNK WiFi Module may not support "Band Steering" and WiFi Channel 13. Try not using these on your router if you are having connectivity issues.
- Some models do not yet have support for displaying the time remaining. If its not working for your model please log a GitHub issue and we will try to add it with your help.
