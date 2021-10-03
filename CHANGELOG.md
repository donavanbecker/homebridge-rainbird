# Changelog

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/)

### NEXT

- Support for rain sensor using the HomeKit leak sensor
- Suppress a zone's active status when scheduled program has been suspended (due to rain)
- Use "Advance Zone" command instead of "Stop Irrigation" so remaining zones can still run for a scheduled program

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

