import { OperationError } from '../types';
import { asBytes } from '../core/bytes';
import { arg, type Operation } from './types';
import { adler32, fletcher16 } from './hashing';


interface CrcModel {
  width: number;
  poly: bigint;
  init: bigint;
  refIn: boolean;
  refOut: boolean;
  xorOut: bigint;
}

const CRC_MODELS = new Map<string, CrcModel>([
  ['CRC-3/GSM', { width: 3, poly: 0x3n, init: 0x0n, refIn: false, refOut: false, xorOut: 0x7n }],
  ['CRC-3/ROHC', { width: 3, poly: 0x3n, init: 0x7n, refIn: true, refOut: true, xorOut: 0x0n }],
  ['CRC-4/G-704', { width: 4, poly: 0x3n, init: 0x0n, refIn: true, refOut: true, xorOut: 0x0n }],
  ['CRC-4/INTERLAKEN', { width: 4, poly: 0x3n, init: 0xFn, refIn: false, refOut: false, xorOut: 0xFn }],
  ['CRC-4/ITU', { width: 4, poly: 0x3n, init: 0x0n, refIn: true, refOut: true, xorOut: 0x0n }],
  ['CRC-5/EPC', { width: 5, poly: 0x09n, init: 0x09n, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-5/EPC-C1G2', { width: 5, poly: 0x09n, init: 0x09n, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-5/G-704', { width: 5, poly: 0x15n, init: 0x00n, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-5/ITU', { width: 5, poly: 0x15n, init: 0x00n, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-5/USB', { width: 5, poly: 0x05n, init: 0x1Fn, refIn: true, refOut: true, xorOut: 0x1Fn }],
  ['CRC-6/CDMA2000-A', { width: 6, poly: 0x27n, init: 0x3Fn, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-6/CDMA2000-B', { width: 6, poly: 0x07n, init: 0x3Fn, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-6/DARC', { width: 6, poly: 0x19n, init: 0x00n, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-6/G-704', { width: 6, poly: 0x03n, init: 0x00n, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-6/GSM', { width: 6, poly: 0x2Fn, init: 0x00n, refIn: false, refOut: false, xorOut: 0x3Fn }],
  ['CRC-6/ITU', { width: 6, poly: 0x03n, init: 0x00n, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-7/MMC', { width: 7, poly: 0x09n, init: 0x00n, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-7/ROHC', { width: 7, poly: 0x4Fn, init: 0x7Fn, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-7/UMTS', { width: 7, poly: 0x45n, init: 0x00n, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8', { width: 8, poly: 0x07n, init: 0x00n, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8/8H2F', { width: 8, poly: 0x2Fn, init: 0xFFn, refIn: false, refOut: false, xorOut: 0xFFn }],
  ['CRC-8/AES', { width: 8, poly: 0x1Dn, init: 0xFFn, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-8/AUTOSAR', { width: 8, poly: 0x2Fn, init: 0xFFn, refIn: false, refOut: false, xorOut: 0xFFn }],
  ['CRC-8/BLUETOOTH', { width: 8, poly: 0xA7n, init: 0x00n, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-8/CDMA2000', { width: 8, poly: 0x9Bn, init: 0xFFn, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8/DARC', { width: 8, poly: 0x39n, init: 0x00n, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-8/DVB-S2', { width: 8, poly: 0xD5n, init: 0x00n, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8/EBU', { width: 8, poly: 0x1Dn, init: 0xFFn, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-8/GSM-A', { width: 8, poly: 0x1Dn, init: 0x00n, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8/GSM-B', { width: 8, poly: 0x49n, init: 0x00n, refIn: false, refOut: false, xorOut: 0xFFn }],
  ['CRC-8/HITAG', { width: 8, poly: 0x1Dn, init: 0xFFn, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8/I-432-1', { width: 8, poly: 0x07n, init: 0x00n, refIn: false, refOut: false, xorOut: 0x55n }],
  ['CRC-8/I-CODE', { width: 8, poly: 0x1Dn, init: 0xFDn, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8/ITU', { width: 8, poly: 0x07n, init: 0x00n, refIn: false, refOut: false, xorOut: 0x55n }],
  ['CRC-8/LTE', { width: 8, poly: 0x9Bn, init: 0x00n, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8/MAXIM', { width: 8, poly: 0x31n, init: 0x00n, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-8/MAXIM-DOW', { width: 8, poly: 0x31n, init: 0x00n, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-8/MIFARE-MAD', { width: 8, poly: 0x1Dn, init: 0xC7n, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8/NRSC-5', { width: 8, poly: 0x31n, init: 0xFFn, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8/OPENSAFETY', { width: 8, poly: 0x2Fn, init: 0x00n, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8/ROHC', { width: 8, poly: 0x07n, init: 0xFFn, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-8/SAE-J1850', { width: 8, poly: 0x1Dn, init: 0xFFn, refIn: false, refOut: false, xorOut: 0xFFn }],
  ['CRC-8/SAE-J1850-ZERO', { width: 8, poly: 0x1Dn, init: 0x00n, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8/SMBUS', { width: 8, poly: 0x07n, init: 0x00n, refIn: false, refOut: false, xorOut: 0x00n }],
  ['CRC-8/TECH-3250', { width: 8, poly: 0x1Dn, init: 0xFFn, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-8/WCDMA', { width: 8, poly: 0x9Bn, init: 0x00n, refIn: true, refOut: true, xorOut: 0x00n }],
  ['CRC-10/ATM', { width: 10, poly: 0x233n, init: 0x000n, refIn: false, refOut: false, xorOut: 0x000n }],
  ['CRC-10/CDMA2000', { width: 10, poly: 0x3D9n, init: 0x3FFn, refIn: false, refOut: false, xorOut: 0x000n }],
  ['CRC-10/GSM', { width: 10, poly: 0x175n, init: 0x000n, refIn: false, refOut: false, xorOut: 0x3FFn }],
  ['CRC-10/I-610', { width: 10, poly: 0x233n, init: 0x000n, refIn: false, refOut: false, xorOut: 0x000n }],
  ['CRC-11/FLEXRAY', { width: 11, poly: 0x385n, init: 0x01An, refIn: false, refOut: false, xorOut: 0x000n }],
  ['CRC-11/UMTS', { width: 11, poly: 0x307n, init: 0x000n, refIn: false, refOut: false, xorOut: 0x000n }],
  ['CRC-12/3GPP', { width: 12, poly: 0x80Fn, init: 0x000n, refIn: false, refOut: true, xorOut: 0x000n }],
  ['CRC-12/CDMA2000', { width: 12, poly: 0xF13n, init: 0xFFFn, refIn: false, refOut: false, xorOut: 0x000n }],
  ['CRC-12/DECT', { width: 12, poly: 0x80Fn, init: 0x000n, refIn: false, refOut: false, xorOut: 0x000n }],
  ['CRC-12/GSM', { width: 12, poly: 0xD31n, init: 0x000n, refIn: false, refOut: false, xorOut: 0xFFFn }],
  ['CRC-12/UMTS', { width: 12, poly: 0x80Fn, init: 0x000n, refIn: false, refOut: true, xorOut: 0x000n }],
  ['CRC-13/BBC', { width: 13, poly: 0x1CF5n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-14/DARC', { width: 14, poly: 0x0805n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-14/GSM', { width: 14, poly: 0x202Dn, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x3FFFn }],
  ['CRC-15/CAN', { width: 15, poly: 0x4599n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-15/MPT1327', { width: 15, poly: 0x6815n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0001n }],
  ['CRC-16', { width: 16, poly: 0x8005n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/A', { width: 16, poly: 0x1021n, init: 0xC6C6n, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/ACORN', { width: 16, poly: 0x1021n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/ARC', { width: 16, poly: 0x8005n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/AUG-CCITT', { width: 16, poly: 0x1021n, init: 0x1D0Fn, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/AUTOSAR', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/B', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFn }],
  ['CRC-16/BLUETOOTH', { width: 16, poly: 0x1021n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/BUYPASS', { width: 16, poly: 0x8005n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/CCITT', { width: 16, poly: 0x1021n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/CCITT-FALSE', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/CCITT-TRUE', { width: 16, poly: 0x1021n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/CCITT-ZERO', { width: 16, poly: 0x1021n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/CDMA2000', { width: 16, poly: 0xC867n, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/CMS', { width: 16, poly: 0x8005n, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/DARC', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFn }],
  ['CRC-16/DDS-110', { width: 16, poly: 0x8005n, init: 0x800Dn, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/DECT-R', { width: 16, poly: 0x0589n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0001n }],
  ['CRC-16/DECT-X', { width: 16, poly: 0x0589n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/DNP', { width: 16, poly: 0x3D65n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0xFFFFn }],
  ['CRC-16/EN-13757', { width: 16, poly: 0x3D65n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0xFFFFn }],
  ['CRC-16/EPC', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFn }],
  ['CRC-16/EPC-C1G2', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFn }],
  ['CRC-16/GENIBUS', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFn }],
  ['CRC-16/GSM', { width: 16, poly: 0x1021n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0xFFFFn }],
  ['CRC-16/I-CODE', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFn }],
  ['CRC-16/IBM', { width: 16, poly: 0x8005n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/IBM-3740', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/IBM-SDLC', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFn }],
  ['CRC-16/IEC-61158-2', { width: 16, poly: 0x1DCFn, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFn }],
  ['CRC-16/ISO-HDLC', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFn }],
  ['CRC-16/ISO-IEC-14443-3-A', { width: 16, poly: 0x1021n, init: 0xC6C6n, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/ISO-IEC-14443-3-B', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFn }],
  ['CRC-16/KERMIT', { width: 16, poly: 0x1021n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/LHA', { width: 16, poly: 0x8005n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/LJ1200', { width: 16, poly: 0x6F63n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/LTE', { width: 16, poly: 0x1021n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/M17', { width: 16, poly: 0x5935n, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/MAXIM', { width: 16, poly: 0x8005n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0xFFFFn }],
  ['CRC-16/MAXIM-DOW', { width: 16, poly: 0x8005n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0xFFFFn }],
  ['CRC-16/MCRF4XX', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/MODBUS', { width: 16, poly: 0x8005n, init: 0xFFFFn, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/NRSC-5', { width: 16, poly: 0x080Bn, init: 0xFFFFn, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/OPENSAFETY-A', { width: 16, poly: 0x5935n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/OPENSAFETY-B', { width: 16, poly: 0x755Bn, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/PROFIBUS', { width: 16, poly: 0x1DCFn, init: 0xFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFn }],
  ['CRC-16/RIELLO', { width: 16, poly: 0x1021n, init: 0xB2AAn, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/SPI-FUJITSU', { width: 16, poly: 0x1021n, init: 0x1D0Fn, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/T10-DIF', { width: 16, poly: 0x8BB7n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/TELEDISK', { width: 16, poly: 0xA097n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/TMS37157', { width: 16, poly: 0x1021n, init: 0x89ECn, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/UMTS', { width: 16, poly: 0x8005n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/USB', { width: 16, poly: 0x8005n, init: 0xFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFn }],
  ['CRC-16/V-41-LSB', { width: 16, poly: 0x1021n, init: 0x0000n, refIn: true, refOut: true, xorOut: 0x0000n }],
  ['CRC-16/V-41-MSB', { width: 16, poly: 0x1021n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/VERIFONE', { width: 16, poly: 0x8005n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/X-25', { width: 16, poly: 0x1021n, init: 0xFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFn }],
  ['CRC-16/XMODEM', { width: 16, poly: 0x1021n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-16/ZMODEM', { width: 16, poly: 0x1021n, init: 0x0000n, refIn: false, refOut: false, xorOut: 0x0000n }],
  ['CRC-17/CAN-FD', { width: 17, poly: 0x1685Bn, init: 0x00000n, refIn: false, refOut: false, xorOut: 0x00000n }],
  ['CRC-21/CAN-FD', { width: 21, poly: 0x102899n, init: 0x000000n, refIn: false, refOut: false, xorOut: 0x000000n }],
  ['CRC-24/BLE', { width: 24, poly: 0x00065Bn, init: 0x555555n, refIn: true, refOut: true, xorOut: 0x000000n }],
  ['CRC-24/FLEXRAY-A', { width: 24, poly: 0x5D6DCBn, init: 0xFEDCBAn, refIn: false, refOut: false, xorOut: 0x000000n }],
  ['CRC-24/FLEXRAY-B', { width: 24, poly: 0x5D6DCBn, init: 0xABCDEFn, refIn: false, refOut: false, xorOut: 0x000000n }],
  ['CRC-24/INTERLAKEN', { width: 24, poly: 0x328B63n, init: 0xFFFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFFFn }],
  ['CRC-24/LTE-A', { width: 24, poly: 0x864CFBn, init: 0x000000n, refIn: false, refOut: false, xorOut: 0x000000n }],
  ['CRC-24/LTE-B', { width: 24, poly: 0x800063n, init: 0x000000n, refIn: false, refOut: false, xorOut: 0x000000n }],
  ['CRC-24/OPENPGP', { width: 24, poly: 0x864CFBn, init: 0xB704CEn, refIn: false, refOut: false, xorOut: 0x000000n }],
  ['CRC-24/OS-9', { width: 24, poly: 0x800063n, init: 0xFFFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFFFn }],
  ['CRC-30/CDMA', { width: 30, poly: 0x2030B9C7n, init: 0x3FFFFFFFn, refIn: false, refOut: false, xorOut: 0x3FFFFFFFn }],
  ['CRC-31/PHILIPS', { width: 31, poly: 0x04C11DB7n, init: 0x7FFFFFFFn, refIn: false, refOut: false, xorOut: 0x7FFFFFFFn }],
  ['CRC-32', { width: 32, poly: 0x04C11DB7n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/AAL5', { width: 32, poly: 0x04C11DB7n, init: 0xFFFFFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/ADCCP', { width: 32, poly: 0x04C11DB7n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/AIXM', { width: 32, poly: 0x814141ABn, init: 0x00000000n, refIn: false, refOut: false, xorOut: 0x00000000n }],
  ['CRC-32/AUTOSAR', { width: 32, poly: 0xF4ACFB13n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/BASE91-C', { width: 32, poly: 0x1EDC6F41n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/BASE91-D', { width: 32, poly: 0xA833982Bn, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/BZIP2', { width: 32, poly: 0x04C11DB7n, init: 0xFFFFFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/C', { width: 32, poly: 0x1EDC6F41n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/CASTAGNOLI', { width: 32, poly: 0x1EDC6F41n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/CD-ROM-EDC', { width: 32, poly: 0x8001801Bn, init: 0x00000000n, refIn: true, refOut: true, xorOut: 0x00000000n }],
  ['CRC-32/CKSUM', { width: 32, poly: 0x04C11DB7n, init: 0x00000000n, refIn: false, refOut: false, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/D', { width: 32, poly: 0xA833982Bn, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/DECT-B', { width: 32, poly: 0x04C11DB7n, init: 0xFFFFFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/INTERLAKEN', { width: 32, poly: 0x1EDC6F41n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/ISCSI', { width: 32, poly: 0x1EDC6F41n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/ISO-HDLC', { width: 32, poly: 0x04C11DB7n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/JAMCRC', { width: 32, poly: 0x04C11DB7n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0x00000000n }],
  ['CRC-32/MEF', { width: 32, poly: 0x741B8CD7n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0x00000000n }],
  ['CRC-32/MPEG-2', { width: 32, poly: 0x04C11DB7n, init: 0xFFFFFFFFn, refIn: false, refOut: false, xorOut: 0x00000000n }],
  ['CRC-32/NVME', { width: 32, poly: 0x1EDC6F41n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/PKZIP', { width: 32, poly: 0x04C11DB7n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/POSIX', { width: 32, poly: 0x04C11DB7n, init: 0x00000000n, refIn: false, refOut: false, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/Q', { width: 32, poly: 0x814141ABn, init: 0x00000000n, refIn: false, refOut: false, xorOut: 0x00000000n }],
  ['CRC-32/SATA', { width: 32, poly: 0x04C11DB7n, init: 0x52325032n, refIn: false, refOut: false, xorOut: 0x00000000n }],
  ['CRC-32/V-42', { width: 32, poly: 0x04C11DB7n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-32/XFER', { width: 32, poly: 0x000000AFn, init: 0x00000000n, refIn: false, refOut: false, xorOut: 0x00000000n }],
  ['CRC-32/XZ', { width: 32, poly: 0x04C11DB7n, init: 0xFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFn }],
  ['CRC-40/GSM', { width: 40, poly: 0x0004820009n, init: 0x0000000000n, refIn: false, refOut: false, xorOut: 0xFFFFFFFFFFn }],
  ['CRC-64/ECMA-182', { width: 64, poly: 0x42F0E1EBA9EA3693n, init: 0x0000000000000000n, refIn: false, refOut: false, xorOut: 0x0000000000000000n }],
  ['CRC-64/GO-ECMA', { width: 64, poly: 0x42F0E1EBA9EA3693n, init: 0xFFFFFFFFFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFFFFFFFFFn }],
  ['CRC-64/GO-ISO', { width: 64, poly: 0x000000000000001Bn, init: 0xFFFFFFFFFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFFFFFFFFFn }],
  ['CRC-64/MS', { width: 64, poly: 0x259C84CBA6426349n, init: 0xFFFFFFFFFFFFFFFFn, refIn: true, refOut: true, xorOut: 0x0000000000000000n }],
  ['CRC-64/NVME', { width: 64, poly: 0xAD93D23594C93659n, init: 0xFFFFFFFFFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFFFFFFFFFn }],
  ['CRC-64/REDIS', { width: 64, poly: 0xAD93D23594C935A9n, init: 0x0000000000000000n, refIn: true, refOut: true, xorOut: 0x0000000000000000n }],
  ['CRC-64/WE', { width: 64, poly: 0x42F0E1EBA9EA3693n, init: 0xFFFFFFFFFFFFFFFFn, refIn: false, refOut: false, xorOut: 0xFFFFFFFFFFFFFFFFn }],
  ['CRC-64/XZ', { width: 64, poly: 0x42F0E1EBA9EA3693n, init: 0xFFFFFFFFFFFFFFFFn, refIn: true, refOut: true, xorOut: 0xFFFFFFFFFFFFFFFFn }],
  ['CRC-82/DARC', { width: 82, poly: 0x0308C0111011401440411n, init: 0x000000000000000000000n, refIn: true, refOut: true, xorOut: 0x000000000000000000000n }],
]);

function reflect(value: bigint, width: bigint): bigint {
  let out = 0n;
  let data = value;
  for (let bit = 0n; bit < width; bit++) {
    if ((data & 1n) === 1n) out |= 1n << (width - 1n - bit);
    data >>= 1n;
  }
  return out;
}

const REFLECTED_BYTES = Array.from({ length: 256 }, (_, i) => reflect(BigInt(i), 8n));

function crcBitwise(bytes: Uint8Array, model: CrcModel): bigint {
  const width = BigInt(model.width);
  const top = 1n << (width - 1n);
  const mask = (1n << width) - 1n;
  let remainder = model.init & mask;

  for (const raw of bytes) {
    const byte = model.refIn ? REFLECTED_BYTES[raw]! : BigInt(raw);
    for (let i = 0x80n; i !== 0n; i >>= 1n) {
      let bit = remainder & top;
      remainder = (remainder << 1n) & mask;
      if ((byte & i) !== 0n) bit ^= top;
      if (bit !== 0n) remainder ^= model.poly;
    }
  }
  return model.refOut ? reflect(remainder, width) : remainder;
}

const CRC_TABLES = new WeakMap<CrcModel, bigint[]>();

function crcTabular(bytes: Uint8Array, model: CrcModel): bigint {
  const width = BigInt(model.width);
  const top = 1n << (width - 1n);
  const mask = (1n << width) - 1n;
  const shift = width - 8n;

  let table = CRC_TABLES.get(model);
  if (!table) {
    table = [];
    for (let byte = 0n; byte < 256n; byte++) {
      let value = (byte << shift) & mask;
      for (let bit = 0; bit < 8; bit++) {
        value = (value & top) === 0n ? (value << 1n) & mask : ((value << 1n) & mask) ^ model.poly;
      }
      table.push(value);
    }
    CRC_TABLES.set(model, table);
  }

  let remainder = model.init & mask;
  for (const raw of bytes) {
    const byte = model.refIn ? REFLECTED_BYTES[raw]! : BigInt(raw);
    remainder ^= (byte << shift) & mask;
    const index = Number(remainder >> shift);
    remainder = (remainder << 8n) & mask;
    remainder ^= table[index]!;
  }
  return model.refOut ? reflect(remainder, width) : remainder;
}

function crc(bytes: Uint8Array, model: CrcModel): string {
  const remainder = model.width < 8 ? crcBitwise(bytes, model) : crcTabular(bytes, model);
  const mask = (1n << BigInt(model.width)) - 1n;
  const value = (remainder ^ model.xorOut) & mask;
  return value.toString(16).padStart(Math.ceil(model.width / 4), '0');
}

function parseHexArg(value: string, label: string): bigint {
  const cleaned = value.trim().replace(/^0x/i, '');
  if (cleaned === '') return 0n;
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) throw new OperationError(`${label} must be hexadecimal.`);
  return BigInt(`0x${cleaned}`);
}


function fletcher8(bytes: Uint8Array): string {
  let a = 0;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 0xf;
    b = (b + a) % 0xf;
  }
  return (((b << 4) | a) >>> 0).toString(16).padStart(2, '0');
}

function fletcher32(bytes: Uint8Array): string {
  let a = 0;
  let b = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    a = (a + (bytes[i]! | (bytes[i + 1]! << 8))) % 0xffff;
    b = (b + a) % 0xffff;
  }
  if (bytes.length % 2 !== 0) {
    a = (a + bytes[bytes.length - 1]!) % 0xffff;
    b = (b + a) % 0xffff;
  }
  return (((b << 16) | a) >>> 0).toString(16).padStart(8, '0');
}

function fletcher64(bytes: Uint8Array): string {
  let a = 0;
  let b = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    a = (a + view.getUint32(i, true)) % 0xffffffff;
    b = (b + a) % 0xffffffff;
  }
  const remainder = bytes.length % 4;
  if (remainder !== 0) {
    let last = 0;
    for (let i = 0; i < remainder; i++) last = (last << 8) | bytes[bytes.length - 1 - i]!;
    a = (a + last) % 0xffffffff;
    b = (b + a) % 0xffffffff;
  }
  return (b >>> 0).toString(16).padStart(8, '0') + (a >>> 0).toString(16).padStart(8, '0');
}


function toBits(text: string): string {
  return Array.from(text)
    .map((char) => (char.charCodeAt(0) & 0xff).toString(2).padStart(8, '0'))
    .join('');
}

function parityOf(bits: string, even: boolean): string {
  const ones = Array.from(bits).filter((b) => b === '1').length;
  const isEven = ones % 2 === 0;
  return (even ? !isEven : isEven) ? '1' : '0';
}


const CRC_ALGORITHMS = ['Custom', ...CRC_MODELS.keys()];

const CRC_WIDTHS = [...new Set([8, 16, 32, 64, ...[...CRC_MODELS.values()].map((m) => m.width)])].sort(
  (a, b) => a - b,
);

export const checksumOperations: Operation[] = [
  {
    id: 'crc-checksum',
    name: 'CRC Checksum',
    category: 'Hashing',
    description: 'Computes any of the published CRC variants, or a custom polynomial of your own.',
    aliases: ['crc', 'cyclic redundancy check', 'crc-8', 'crc-64'],
    args: [
      { name: 'Algorithm', type: 'option', value: 'CRC-32/ISO-HDLC', options: CRC_ALGORITHMS },
      { name: 'Width', type: 'number', value: 32, min: 1, max: 128, hint: 'Custom only' },
      { name: 'Polynomial', type: 'string', value: '04C11DB7', hint: 'Custom only, hex' },
      { name: 'Initialisation', type: 'string', value: 'FFFFFFFF', hint: 'Custom only, hex' },
      { name: 'Reflect input', type: 'boolean', value: true, hint: 'Custom only' },
      { name: 'Reflect output', type: 'boolean', value: true, hint: 'Custom only' },
      { name: 'Final XOR', type: 'string', value: 'FFFFFFFF', hint: 'Custom only, hex' },
    ],
    run: (input, args) => {
      const name = String(arg(args, 'Algorithm', 'CRC-32/ISO-HDLC'));
      const bytes = asBytes(input);

      if (name !== 'Custom') {
        const model = CRC_MODELS.get(name);
        if (!model) throw new OperationError(`'${name}' is not a known CRC variant.`);
        return crc(bytes, model);
      }

      const width = Number(arg(args, 'Width', 32));
      if (!Number.isInteger(width) || width < 1 || width > 128) {
        throw new OperationError('Width must be a whole number of bits between 1 and 128.');
      }
      return crc(bytes, {
        width,
        poly: parseHexArg(String(arg(args, 'Polynomial', '')), 'Polynomial'),
        init: parseHexArg(String(arg(args, 'Initialisation', '')), 'Initialisation'),
        refIn: arg(args, 'Reflect input', true),
        refOut: arg(args, 'Reflect output', true),
        xorOut: parseHexArg(String(arg(args, 'Final XOR', '')), 'Final XOR'),
      });
    },
  },
  {
    id: 'fletcher-8',
    name: 'Fletcher-8 Checksum',
    category: 'Hashing',
    description: 'Computes the 8-bit Fletcher checksum.',
    aliases: ['fletcher8'],
    args: [],
    run: (input) => fletcher8(asBytes(input)),
  },
  {
    id: 'fletcher-32',
    name: 'Fletcher-32 Checksum',
    category: 'Hashing',
    description: 'Computes the 32-bit Fletcher checksum over 16-bit words.',
    aliases: ['fletcher32'],
    args: [],
    run: (input) => fletcher32(asBytes(input)),
  },
  {
    id: 'fletcher-64',
    name: 'Fletcher-64 Checksum',
    category: 'Hashing',
    description: 'Computes the 64-bit Fletcher checksum over 32-bit words.',
    aliases: ['fletcher64'],
    args: [],
    run: (input) => fletcher64(asBytes(input)),
  },
  {
    id: 'luhn-checksum',
    name: 'Luhn Checksum',
    category: 'Hashing',
    description:
      'The Luhn mod N check digit, used by card numbers and many identifiers. Radix 10 is the familiar one.',
    aliases: ['luhn', 'mod 10', 'card check digit'],
    args: [{ name: 'Radix', type: 'number', value: 10, min: 2, max: 36 }],
    run: (input, args) => {
      if (input.length === 0) return '';
      const radix = Number(arg(args, 'Radix', 10));
      if (!Number.isInteger(radix) || radix < 2 || radix > 36) {
        throw new OperationError('Radix must be a whole number between 2 and 36.');
      }

      let even = false;
      let total = 0;
      for (const char of Array.from(input).reverse()) {
        let value = parseInt(char, radix);
        if (Number.isNaN(value)) {
          throw new OperationError(`'${char}' is not a valid digit in radix ${radix}.`);
        }
        if (even) {
          value *= 2;
          value = Math.floor(value / radix) + (value % radix);
        }
        even = !even;
        total += value;
      }

      const checksum = total % radix;
      return `Checksum: ${checksum.toString(radix)}\nChecked data: ${input}${checksum.toString(radix)}`;
    },
  },
  {
    id: 'xor-checksum',
    name: 'XOR Checksum',
    category: 'Hashing',
    description: 'Splits the input into blocks and XORs them together.',
    aliases: ['lrc', 'longitudinal redundancy check'],
    args: [{ name: 'Block size', type: 'number', value: 4, min: 1, max: 1024 }],
    run: (input, args) => {
      const size = Number(arg(args, 'Block size', 4));
      if (!Number.isInteger(size) || size <= 0) {
        throw new OperationError('Block size must be a positive whole number.');
      }
      const bytes = asBytes(input);
      const out = new Uint8Array(size);
      for (let i = 0; i < bytes.length; i++) out[i % size] = out[i % size]! ^ bytes[i]!;
      return Array.from(out)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    },
  },
  {
    id: 'tcp-ip-checksum',
    name: 'TCP/IP Checksum',
    category: 'Hashing',
    description: 'The ones-complement header checksum used by IPv4, TCP and UDP.',
    aliases: ['ip checksum', 'header checksum', 'internet checksum'],
    args: [],
    run: (input) => {
      const bytes = asBytes(input);
      let sum = 0;
      for (let i = 0; i < bytes.length; i++) {
        sum += i % 2 === 0 ? bytes[i]! << 8 : bytes[i]!;
      }
      sum = (sum >> 16) + (sum & 0xffff);
      return ((0xffff - sum) & 0xffff).toString(16).padStart(4, '0');
    },
  },
  {
    id: 'parity-bit',
    name: 'Parity Bit',
    category: 'Hashing',
    description: 'Adds or checks the single bit that makes the count of ones even or odd.',
    aliases: ['parity', 'check bit'],
    args: [
      { name: 'Mode', type: 'option', value: 'Even Parity', options: ['Even Parity', 'Odd Parity'] },
      { name: 'Position', type: 'option', value: 'Start', options: ['Start', 'End'] },
      { name: 'Direction', type: 'option', value: 'Encode', options: ['Encode', 'Decode'] },
      { name: 'Delimiter', type: 'string', value: '', hint: 'Blank treats the input as one block' },
    ],
    run: (input, args) => {
      if (input.length === 0) return input;
      const even = arg(args, 'Mode', 'Even Parity') === 'Even Parity';
      const atStart = arg(args, 'Position', 'Start') === 'Start';
      const encoding = arg(args, 'Direction', 'Encode') === 'Encode';
      const delimiter = String(arg(args, 'Delimiter', ''));

      const encode = (block: string) => {
        const bits = toBits(block);
        const bit = parityOf(bits, even);
        return atStart ? bit + bits : bits + bit;
      };

      const decode = (block: string) => {
        const bits = block.replace(/[^01]/g, '');
        if (bits.length < 2) throw new OperationError('A block needs a parity bit and some data.');
        const body = atStart ? bits.slice(1) : bits.slice(0, -1);
        const found = atStart ? bits[0]! : bits[bits.length - 1]!;
        const expected = parityOf(body, even);
        const verdict = found === expected ? 'OK' : 'FAILED';
        const text = (body.match(/.{1,8}/g) ?? [])
          .map((byte) => String.fromCharCode(parseInt(byte.padEnd(8, '0'), 2)))
          .join('');
        return `${verdict}: ${text}`;
      };

      const apply = encoding ? encode : decode;
      if (delimiter.length === 0) return apply(input);
      return input.split(delimiter).map(apply).join(delimiter);
    },
  },
  {
    id: 'all-checksums',
    name: 'Generate all checksums',
    category: 'Hashing',
    description: 'Runs every checksum at once, for when you have a value but not its algorithm.',
    aliases: ['every checksum', 'all crc', 'checksum sweep'],
    args: [
      {
        name: 'Length (bits)',
        type: 'option',
        value: 'All',
        options: ['All', ...CRC_WIDTHS.map(String)],
        hint: 'Narrows the list to checksums of one width',
      },
      { name: 'Include names', type: 'boolean', value: true },
    ],
    run: (input, args) => {
      const bytes = asBytes(input);
      const wanted = String(arg(args, 'Length (bits)', 'All'));
      const width = wanted === 'All' ? null : Number(wanted);

      const rows: Array<[string, number, string]> = [];
      const add = (name: string, bits: number, value: string) => {
        if (width === null || width === bits) rows.push([name, bits, value]);
      };

      add('Fletcher-8', 8, fletcher8(bytes));
      add('Adler-32', 32, adler32(bytes));
      add('Fletcher-16', 16, fletcher16(bytes));
      add('Fletcher-32', 32, fletcher32(bytes));
      add('Fletcher-64', 64, fletcher64(bytes));
      for (const [name, model] of CRC_MODELS) add(name, model.width, crc(bytes, model));

      if (rows.length === 0) return `No checksum in this catalogue is ${wanted} bits wide.`;
      if (!arg(args, 'Include names', true)) return rows.map(([, , value]) => value).join('\n');

      const pad = Math.max(...rows.map(([name]) => name.length));
      return rows.map(([name, , value]) => `${name.padEnd(pad)}  ${value}`).join('\n');
    },
  },
];
