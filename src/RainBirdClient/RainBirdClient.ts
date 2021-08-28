import fetch = require('node-fetch');
import crypto = require('crypto');
import encoder = require('text-encoder');
import aesjs = require('aes-js');

import { Logger } from 'homebridge';
import { Request } from './requests/Request';
import { Response } from './responses/Response';
import { ModelAndVersionRequest } from './requests/ModelAndVersionRequest';
import { ModelAndVersionResponse } from './responses/ModelAndVersionResponse';
import { AvailableZonesResponse } from './responses/AvailableZonesResponse';
import { AvailableZonesRequest } from './requests/AvailableZonesRequest';
import { SerialNumberResponse } from './responses/SerialNumberResponse';
import { SerialNumberRequest } from './requests/SerialNumberRequest';
import { AcknowledgedResponse } from './responses/AcknowledgedResponse';
import { NotAcknowledgedResponse } from './responses/NotAcknowledgedResponse';
import { RunZoneRequest } from './requests/RunZoneRequest';
import { StopIrrigationRequest } from './requests/StopIrrigationRequest';
import { ControllerStateResponse } from './responses/ControllerStateResponse';

export class RainBirdClient {

  constructor(
    private readonly address: string,
    private readonly password: string,
    private readonly log: Logger) {
  }

  async getModelAndVersion(): Promise<ModelAndVersionResponse> {
    const request = new ModelAndVersionRequest();
    return await this.sendRequest(request) as ModelAndVersionResponse;
  }

  async getAvailableZones(): Promise<AvailableZonesResponse> {
    const request = new AvailableZonesRequest();
    return await this.sendRequest(request) as AvailableZonesResponse;
  }

  async getSerialNumber(): Promise<SerialNumberResponse> {
    const request = new SerialNumberRequest();
    return await this.sendRequest(request) as SerialNumberResponse;
  }

  async runZone(zone: number, duration: number): Promise<AcknowledgedResponse | NotAcknowledgedResponse> {
    const request = new RunZoneRequest(zone, duration);
    const response = await this.sendRequest(request);
    return response!.type === 0
      ? response as NotAcknowledgedResponse
      : response as AcknowledgedResponse;
  }

  async stopIrrigation(): Promise<AcknowledgedResponse | NotAcknowledgedResponse> {
    const request = new StopIrrigationRequest();
    const response = await this.sendRequest(request);
    return response!.type === 0
      ? response as NotAcknowledgedResponse
      : response as AcknowledgedResponse;
  }

  private async sendRequest(request: Request): Promise<Response | undefined> {
    this.log.debug(`Request: ${request}`);

    try {
      const url = `http://${this.address}/stick`;
      const body: Buffer = this.encrypt(request);
      const resp = await fetch(url, this.createRequestOptions(body));

      if (!resp.ok || resp.status !== 200) {
        this.log.error(`Invalid Response [Status: ${resp.status}, Text: ${resp.statusText}]`);
        return;
      }

      const encryptedResponse: Buffer = await resp.buffer();
      const response = this.getResponse(encryptedResponse);

      return response;
    } catch(error) {
      this.log.error(`Send Request Failed: ${error}`);
      throw error;
    }
  }

  private getResponse(encryptedResponse: Buffer): Response | undefined {
    const decryptedResponse = JSON.parse(this.decrypt(encryptedResponse).replace(/[\x10\x0A\x00]/g, ''));

    if (!decryptedResponse) {
      this.log.error('No response received');
      return;
    }
    if (decryptedResponse.error) {
      this.log.error(
        `Received error from Rainbird controller ${decryptedResponse.error.code}: ${decryptedResponse.error.message}`);
      return;
    }
    if (!decryptedResponse.result) {
      this.log.error('Invalid response received');
      return;
    }
    const data = Buffer.from(decryptedResponse.result.data, 'hex');

    let response: Response | undefined = undefined;
    switch (data[0]) {
      case 0x00:
        response = new NotAcknowledgedResponse(data);
        break;
      case 0x01:
        response = new AcknowledgedResponse(data);
        break;
      case 0x82:
        response = new ModelAndVersionResponse(data);
        break;
      case 0x83:
        response = new AvailableZonesResponse(data);
        break;
      case 0x85:
        response = new SerialNumberResponse(data);
        break;
      case 0xCC:
        response = new ControllerStateResponse(data);
        break;
    }

    this.log.debug(`Response: ${response ?? 'Unknown'}`);

    return response;
  }

  private encrypt(request: Request): Buffer {
    const formattedRequest = this.formatRequest(request);
    const
      passwordHash = crypto.createHash('sha256').update(this.toBytes(this.password)).digest(),
      randomBytes = crypto.randomBytes(16),
      packedRequest = this.toBytes(this.addPadding(`${formattedRequest}\x00\x10`)),
      hashedRequest = crypto.createHash('sha256').update(this.toBytes(formattedRequest)).digest(),
      easEncryptor = new aesjs.ModeOfOperation.cbc(passwordHash, randomBytes),
      encryptedRequest = Buffer.from(easEncryptor.encrypt(packedRequest));
    return Buffer.concat([hashedRequest, randomBytes, encryptedRequest]);
  }

  private decrypt(data: Buffer): string {
    const
      passwordHash = crypto.createHash('sha256').update(this.toBytes(this.password)).digest().slice(0, 32),
      randomBytes = data.slice(32, 48),
      encryptedBody = data.slice(48, data.length),
      aesDecryptor = new aesjs.ModeOfOperation.cbc(passwordHash, randomBytes);
    return new encoder.TextDecoder().decode(aesDecryptor.decrypt(encryptedBody));
  }

  private formatRequest(request: Request) {
    const data: Buffer = request.toBuffer();
    return JSON.stringify({
      'id': 9,
      'jsonrpc': '2.0',
      'method': 'tunnelSip',
      'params': {
        'data': data.toString('hex'),
        'length': data.length,
      },
    });
  }

  private createRequestOptions(body: Buffer) {
    return {
      method: 'POST',
      body: body,
      headers: {
        'Accept-Language': 'en',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': 'RainBird/2.0 CFNetwork/811.5.4 Darwin/16.7.0',
        'Accept': '*/*',
        'Connection': 'keep-alive',
        'Content-Type': 'application/octet-stream',
      },
    };
  }

  private toBytes(str: string) {
    return new encoder.TextEncoder('utf-8').encode(str);
  }

  private addPadding(data: string): string {
    const BLOCK_SIZE = 16;
    const dataLength = data.length;
    const charsToAdd = (dataLength + BLOCK_SIZE) - (dataLength % BLOCK_SIZE) - dataLength;
    const pad_string = Array(charsToAdd + 1).join('\x10');
    return [data, pad_string].join('');
  }
}