/**
 * HL7 v2.x Message Parser for Laboratory Results
 *
 * Parses standard HL7 messages (ORU^R01 for lab results)
 * Segments: MSH, PID, OBR, OBX
 */

export interface HL7PatientInfo {
  id: string;
  name?: string;
  dateOfBirth?: string;
  sex?: string;
}

export interface HL7Order {
  orderId: string;
  testCode: string;
  testName?: string;
  orderDate?: string;
}

export interface HL7Result {
  sequenceNumber?: string;
  testCode: string;
  testName?: string;
  value: string;
  unit?: string;
  referenceRange?: string;
  flag?: string; // H (High), L (Low), N (Normal), A (Abnormal)
  status?: string;
  observedDate?: string;
}

export interface HL7ParsedMessage {
  messageType?: string;
  patient: HL7PatientInfo;
  orders: HL7Order[];
  results: HL7Result[];
  rawMessage: string;
}

/**
 * Parse HL7 v2.x message
 */
export function parseHL7Message(hl7: string): HL7ParsedMessage {
  const segments = hl7.split(/\r?\n/);
  const result: HL7ParsedMessage = {
    patient: { id: '' },
    orders: [],
    results: [],
    rawMessage: hl7,
  };

  for (const segment of segments) {
    if (!segment.trim()) continue;

    const fields = segment.split('|');
    const segmentType = fields[0];

    switch (segmentType) {
      case 'MSH': // Message Header
        if (fields[8]) {
          result.messageType = fields[8]; // Message Type (e.g., ORU^R01)
        }
        break;

      case 'PID': // Patient Identification
        result.patient = {
          id: fields[3] || '', // Patient ID (PID-3)
          name: fields[5] || undefined, // Patient Name (PID-5)
          dateOfBirth: fields[7] || undefined, // Date of Birth (PID-7)
          sex: fields[8] || undefined, // Sex (PID-8)
        };
        break;

      case 'OBR': // Observation Request (Test Order)
        result.orders.push({
          orderId: fields[2] || fields[3] || '', // Placer/Filler Order Number
          testCode: fields[4]?.split('^')[0] || '', // Universal Service ID
          testName: fields[4]?.split('^')[1] || undefined,
          orderDate: fields[7] || undefined, // Observation Date/Time
        });
        break;

      case 'OBX': {
        // Observation Result
        const testIdentifier = fields[3] || '';
        const testParts = testIdentifier.split('^');

        result.results.push({
          sequenceNumber: fields[1] || undefined, // Set ID
          testCode: testParts[0] || '', // Test Code
          testName: testParts[1] || undefined, // Test Name
          value: fields[5] || '', // Observation Value
          unit: fields[6] || undefined, // Units
          referenceRange: fields[7] || undefined, // Reference Range
          flag: fields[8] || undefined, // Abnormal Flags
          status: fields[11] || undefined, // Observation Result Status
          observedDate: fields[14] || undefined, // Date/Time of Observation
        });
        break;
      }
    }
  }

  return result;
}

/**
 * Validate HL7 message structure
 */
export function validateHL7Message(hl7: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!hl7 || hl7.trim().length === 0) {
    errors.push('Empty message');
    return { valid: false, errors };
  }

  // Check for MSH segment
  if (!hl7.startsWith('MSH')) {
    errors.push('Message must start with MSH segment');
  }

  // Check for PID segment
  if (!hl7.includes('\nPID') && !hl7.includes('\rPID')) {
    errors.push('Missing PID (Patient Identification) segment');
  }

  // Check for OBX segments
  if (!hl7.includes('\nOBX') && !hl7.includes('\rOBX')) {
    errors.push('No OBX (Observation Results) segments found');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate HL7 ACK (acknowledgment) message
 */
export function generateHL7ACK(
  originalMessage: string,
  status: 'AA' | 'AE' = 'AA',
): string {
  const segments = originalMessage.split(/\r?\n/);
  const mshFields = segments[0].split('|');

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 14);
  const controlId = mshFields[9] || timestamp;

  const ack = [
    `MSH|^~\\&|${mshFields[4]}|${mshFields[5]}|${mshFields[2]}|${mshFields[3]}|${timestamp}||ACK|${controlId}|P|2.5`,
    `MSA|${status}|${controlId}`,
  ].join('\r');

  return ack;
}
