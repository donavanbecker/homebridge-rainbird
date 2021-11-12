# Changelog

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/)

## [Version 1.5.1](https://github.com/donavanbecker/homebridge-rainbird/compare/v1.5.0...v1.5.1) (2021-11-12)

### Changes

- Housekeeping and updated dependencies.

## [Version 1.5.0](https://github.com/donavanbecker/homebridge-rainbird/compare/v1.4.0...v1.5.0) (2021-11-06)

### Changes

- Added enableZone to find Enabled Zones
- Added Command Logging for plugin
- Housekeeping and updated dependencies.

## [Version 1.4.0](https://github.com/donavanbecker/homebridge-rainbird/compare/v1.3.0...v1.4.0) (2021-10-28)

### Changes

- Added support to show vavles as contact sensors
    - Allows you to get notified in the Home App when a Zone has started.
- Added Device Logging and Debug Logging for plugin
- Changed from `node-fetch` to `axios`
- Housekeeping and updated dependencies.
- Persist configured and duration values
- Fixed issue where some models were not able to stop a zone

## [Version 1.3.0](https://github.com/donavanbecker/homebridge-rainbird/compare/v1.2.0...v1.3.0) (2021-10-09)

### Changes

- Support for rain sensor using the HomeKit leak sensor
- Suppress a zone's active status when scheduled program has been suspended (due to rain)
- Use "Advance Zone" command instead of "Stop Irrigation" so remaining zones can still run for a scheduled program
- Fixed `RainBird controller request failed RangeError [ERR_OUT_OF_RANGE]` for ESP-ME3 [#57](https://github.com/donavanbecker/homebridge-rainbird/issues/57)

## [Version 1.2.0](https://github.com/donavanbecker/homebridge-rainbird/compare/v1.1.0...v1.2.0) (2021-09-29)

### Changes

- Added CurrentZoneTimeRemainingRequest & CurrentZoneTimeRemainingResponse function.
- Fixed issue where some RainBird controllers (such as ESP-RZXe & ESP-Me) couldn't show the time remaining for a zone that was not started via the plugin (such as a scheduled program).

## [Version 1.1.0](https://github.com/donavanbecker/homebridge-rainbird/compare/v1.0.0...v1.1.0) (2021-09-27)

### Changes

- Add Support for More Models and Added Compatiable Models to Readme.
- Fixed `Failed to Discover Devices, "Cannot read property 'getTime' of undefined"` [#39](https://github.com/donavanbecker/homebridge-rainbird/issues/39).

## [Version 1.0.0](https://github.com/donavanbecker/homebridge-rainbird/compare/v0.1.0...v1.0.0) (2021-09-19)

### Changes

- Official Release of Homebridge RainBird Plugin.

## [Version 0.2.0](https://github.com/donavanbecker/homebridge-rainbird/tag/v0.0.1) (2021-09-17)

### Changes

- Add Plugin Debug Config Option

## [Version 0.1.0](https://github.com/donavanbecker/homebridge-rainbird/tag/v0.0.1) (2021-08-29)

### Changes

- Initial Release

