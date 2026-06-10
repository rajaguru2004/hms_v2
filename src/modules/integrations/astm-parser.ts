/**
 * ASTM E1394 Message Parser for Laboratory Analyzers
 *
 * ASTM format commonly used by laboratory analyzers (Sysmex, Cobas, etc.)
 * Record types: H (Header), P (Patient), O (Order), R (Result), L (Terminator)
 */

export interface ASTMPatientInfo {
  id: string;
  name?: string;
  dateOfBirth?: string;
  sex?: string;
}

export interface ASTMOrder {
  specimenId: string;
  testCode: string;
  priority?: string;
  sampleType?: string;
  orderTimestamp?: string;
}

export interface ASTMResult {
  testCode: string;
  testName?: string;
  value: string;
  unit?: string;
  referenceRange?: string;
  flag?: string; // N (Normal), H (High), L (Low), A (Abnormal)
  status?: string; // F (Final), C (Corrected), P (Preliminary)
  timestamp?: string;
  operatorId?: string;
}

export interface ASTMParsedMessage {
  header?: {
    senderId?: string;
    receiverId?: string;
    timestamp?: string;
  };
  patient: ASTMPatientInfo;
  orders: ASTMOrder[];
  results: ASTMResult[];
  rawMessage: string;
}

/**
 * Parse ASTM E1394 message
 */
export function parseASTMMessage(astm: string): ASTMParsedMessage {
  // Remove STX (0x02), ETX (0x03), and other control characters
  // eslint-disable-next-line no-control-regex
  const cleaned = astm.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
  const records = cleaned.split(/\r?\n/).filter((r) => r.trim());

  const result: ASTMParsedMessage = {
    patient: { id: '' },
    orders: [],
    results: [],
    rawMessage: astm,
  };

  let currentOrder: ASTMOrder | null = null;

  for (const record of records) {
    if (!record.trim()) continue;

    const fields = record.split('|');
    const recordType = fields[0]?.[0]; // First character is record type

    switch (recordType) {
      case 'H': // Header Record
        result.header = {
          senderId: fields[4] || undefined,
          receiverId: fields[9] || undefined,
          timestamp: fields[13] || undefined,
        };
        break;

      case 'P': // Patient Record
        result.patient = {
          id: fields[3] || '', // Patient ID
          name: fields[5] || undefined,
          dateOfBirth: fields[8] || undefined,
          sex: fields[7] || undefined,
        };
        break;

      case 'O': // Test Order Record
        currentOrder = {
          specimenId: fields[2] || '', // Specimen ID
          testCode: fields[4]?.split('^')[3] || '',
          priority: fields[5] || undefined,
          sampleType: fields[15] || undefined,
          orderTimestamp: fields[6] || undefined,
        };
        result.orders.push(currentOrder);
        break;

      case 'R': {
        // Result Record
        const testIdentifier = fields[2] || '';
        const testParts = testIdentifier.split('^');

        result.results.push({
          testCode: testParts[3] || testParts[0] || '', // Universal Test ID or local code
          testName: testParts[4] || testParts[1] || undefined,
          value: fields[3] || '', // Data Value
          unit: fields[4] || undefined,
          referenceRange: fields[5] || undefined,
          flag: fields[6] || undefined, // Result Abnormal Flags
          status: fields[8] || undefined, // Result Status
          timestamp: fields[12] || undefined,
          operatorId: fields[10] || undefined,
        });
        break;
      }

      case 'L': // Terminator Record
        // End of message
        break;
    }
  }

  return result;
}

/**
 * Validate ASTM message structure
 */
export function validateASTMMessage(astm: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!astm || astm.trim().length === 0) {
    errors.push('Empty message');
    return { valid: false, errors };
  }

  // Check for required record types
  const hasHeader = /^H\|/m.test(astm);
  const hasPatient = /^P\|/m.test(astm);
  const hasResults = /^R\|/m.test(astm);
  const hasTerminator = /^L\|/m.test(astm);

  if (!hasHeader) {
    errors.push('Missing H (Header) record');
  }
  if (!hasPatient) {
    errors.push('Missing P (Patient) record');
  }
  if (!hasResults) {
    errors.push('No R (Result) records found');
  }
  if (!hasTerminator) {
    errors.push('Missing L (Terminator) record');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate ASTM ACK (acknowledgment)
 */
export function generateASTMACK(): string {
  return '\x06'; // ACK character (0x06)
}

/**
 * Generate ASTM NAK (negative acknowledgment)
 */
export function generateASTMNAK(): string {
  return '\x15'; // NAK character (0x15)
}
