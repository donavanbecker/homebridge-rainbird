import axios, { AxiosInstance, AxiosResponse } from 'axios';
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
import { RunProgramRequest } from './requests/RunProgramRequest';
import { RunZoneRequest } from './requests/RunZoneRequest';
import { StopIrrigationRequest } from './requests/StopIrrigationRequest';
import { ControllerStateResponse } from './responses/ControllerStateResponse';
import { ControllerStateRequest } from './requests/ControllerStateRequest';
import { ControllerDateRequest } from './requests/ControllerDateRequest';
import { ControllerDateResponse } from './responses/ControllerDateResponse';
import { ControllerTimeRequest } from './requests/ControllerTimeRequest';
import { ControllerTimeResponse } from './responses/ControllerTimeResponse';
import { IrrigationStateRequest } from './requests/IrrigationStateRequest';
import { IrrigationStateResponse } from './responses/IrrigationStateResponse';
import { RainSensorStateRequest } from './requests/RainSensorStateRequest';
import { RainSensorStateResponse } from './responses/RainSensorStateResponse';
import { CurrentZoneRequest } from './requests/CurrentZoneRequest';
import { CurrentZoneResponse } from './responses/CurrentZoneResponse';
import { CurrentZoneStateRequest } from './requests/CurrentZoneStateRequest';
import { CurrentZoneStateResponse } from './responses/CurrentZoneStateResponse';
import { AdvanceZoneRequest } from './requests/AdvanceZoneRequest';

export class RainBirdClient {
  private readonly RETRY_DELAY = 60;


  public axios: AxiosInstance = axios.create({
    responseType: 'json',
  });

  constructor(
    private readonly address: string,
    private readonly password: string,
    private readonly log: Logger) {
  }

  public async getModelAndVersion(): Promise<ModelAndVersionResponse> {
    const request = new ModelAndVersionRequest();
    return await this.sendRequest(request) as ModelAndVersionResponse;
  }

  public async getAvailableZones(): Promise<AvailableZonesResponse> {
    const request = new AvailableZonesRequest();
    return await this.sendRequest(request) as AvailableZonesResponse;
  }

  public async getSerialNumber(): Promise<SerialNumberResponse> {
    const request = new SerialNumberRequest();
    return await this.sendRequest(request) as SerialNumberResponse;
  }

  public async runProgram(program: number): Promise<AcknowledgedResponse | NotAcknowledgedResponse> {
    const request = new RunProgramRequest(program);
    const response = await this.sendRequest(request);
    return response!.type === 0
      ? response as NotAcknowledgedResponse
      : response as AcknowledgedResponse;
  }

  public async runZone(zone: number, duration: number): Promise<AcknowledgedResponse | NotAcknowledgedResponse> {
    const request = new RunZoneRequest(zone, Math.round(duration / 60));
    const response = await this.sendRequest(request);
    return response!.type === 0
      ? response as NotAcknowledgedResponse
      : response as AcknowledgedResponse;
  }

  public async advanceZone(): Promise<AcknowledgedResponse | NotAcknowledgedResponse> {
    const request = new AdvanceZoneRequest();
    const response = await this.sendRequest(request);
    return response!.type === 0
      ? response as NotAcknowledgedResponse
      : response as AcknowledgedResponse;
  }

  public async stopIrrigation(): Promise<AcknowledgedResponse | NotAcknowledgedResponse> {
    const request = new StopIrrigationRequest();
    const response = await this.sendRequest(request);
    return response!.type === 0
      ? response as NotAcknowledgedResponse
      : response as AcknowledgedResponse;
  }

  public async getControllerState(): Promise<ControllerStateResponse> {
    const request = new ControllerStateRequest();
    return await this.sendRequest(request, false) as ControllerStateResponse;
  }

  public async getControllerDate(): Promise<ControllerDateResponse> {
    const request = new ControllerDateRequest();
    return await this.sendRequest(request, false) as ControllerDateResponse;
  }

  public async getControllerTime(): Promise<ControllerTimeResponse> {
    const request = new ControllerTimeRequest();
    return await this.sendRequest(request, false) as ControllerTimeResponse;
  }

  public async getIrrigationState(): Promise<IrrigationStateResponse> {
    const request = new IrrigationStateRequest();
    return await this.sendRequest(request, false) as IrrigationStateResponse;
  }

  public async getRainSensorState(): Promise<RainSensorStateResponse> {
    const request = new RainSensorStateRequest();
    return await this.sendRequest(request, false) as RainSensorStateResponse;
  }

  public async getCurrentZone(): Promise<CurrentZoneResponse> {
    const request = new CurrentZoneRequest();
    return await this.sendRequest(request, false) as CurrentZoneResponse;
  }

  public async getCurrentZoneState(): Promise<CurrentZoneStateResponse> {
    const request = new CurrentZoneStateRequest();
    return await this.sendRequest(request, false) as CurrentZoneStateResponse;
  }

  private async sendRequest(request: Request, retry = true): Promise<Response | undefined> {
    this.log.debug(`Request: ${request}`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const url = `http://${this.address}/stick`;
        const body: Buffer = this.encrypt(request);
        const resp: AxiosResponse<any> = await axios.post(url, this.createRequestOptions(body));
        this.log.warn(`RainBird controller request: [${resp}]`);

        if (!resp.statusText || resp.status !== 200) {
          throw new Error(`Invalid Response [Status: ${resp.status}, Text: ${resp.statusText}]`);
        }

        const encryptedResponse: Buffer = resp.data.body;
        const response = this.getResponse(encryptedResponse);

        return response;
      } catch (error) {
        this.log.warn(`RainBird controller request failed. [${error}]`);
        if (!retry) {
          break;
        }
        this.log.warn(`Will retry in ${this.RETRY_DELAY} seconds`);
        await this.delay(this.RETRY_DELAY);
      }
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
      case 0x90:
        response = new ControllerTimeResponse(data);
        break;
      case 0x92:
        response = new ControllerDateResponse(data);
        break;
      case 0xBB:
        response = new CurrentZoneStateResponse(data);
        break;
      case 0xBE:
        response = new RainSensorStateResponse(data);
        break;
      case 0xBF:
        response = new CurrentZoneResponse(data);
        break;
      case 0xC8:
        response = new IrrigationStateResponse(data);
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

  private async delay(sec: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve('');
      }, sec * 1000);
    });
  }
}