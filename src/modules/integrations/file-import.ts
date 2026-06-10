import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface ParsedResult {
  patientId: string;
  patientName?: string;
  testCode: string;
  testName?: string;
  result: string;
  unit?: string;
  referenceRange?: string;
  timestamp?: Date;
  status?: string;
}

export interface FileImportResult {
  success: boolean;
  data: ParsedResult[];
  errors: string[];
  totalRows: number;
  parsedRows: number;
}

/**
 * Parse Excel file buffer for laboratory/radiology results
 */
export function parseExcelResults(buffer: Buffer): FileImportResult {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    const results: ParsedResult[] = [];
    const errors: string[] = [];

    jsonData.forEach((rowRaw: unknown, index: number) => {
      try {
        const row = rowRaw as Record<
          string,
          string | number | boolean | Date | null | undefined
        >;

        const rawPatientId =
          row['Patient ID'] ??
          row['MRN'] ??
          row['patient_id'] ??
          row['PatientID'] ??
          '';
        const patientId = String(rawPatientId).trim();

        const rawPatientName =
          row['Patient Name'] ??
          row['PatientName'] ??
          row['patient_name'] ??
          undefined;
        const patientName = rawPatientName ? String(rawPatientName) : undefined;

        const rawTestCode =
          row['Test Code'] ?? row['TestCode'] ?? row['test_code'] ?? '';
        const testCode = String(rawTestCode).trim();

        const rawTestName =
          row['Test Name'] ?? row['TestName'] ?? row['test_name'] ?? undefined;
        const testName = rawTestName ? String(rawTestName) : undefined;

        const rawResult =
          row['Result'] ?? row['Value'] ?? row['result'] ?? row['value'] ?? '';
        const result = String(rawResult).trim();

        const rawUnit = row['Unit'] ?? row['Units'] ?? row['unit'] ?? undefined;
        const unit = rawUnit ? String(rawUnit) : undefined;

        const rawRefRange =
          row['Reference Range'] ??
          row['ReferenceRange'] ??
          row['reference_range'] ??
          undefined;
        const referenceRange = rawRefRange ? String(rawRefRange) : undefined;

        const rawStatus = row['Status'] ?? row['status'] ?? undefined;
        const status = rawStatus ? String(rawStatus) : undefined;

        // Flexible column mapping
        const resultObj: ParsedResult = {
          patientId,
          patientName,
          testCode,
          testName,
          result,
          unit,
          referenceRange,
          status,
        };

        // Add timestamp if available
        const dateValue =
          row['Date'] ??
          row['Timestamp'] ??
          row['date'] ??
          row['timestamp'] ??
          undefined;
        if (dateValue) {
          resultObj.timestamp = new Date(String(dateValue));
        }

        // Validate required fields
        if (!resultObj.patientId || !resultObj.testCode || !resultObj.result) {
          errors.push(
            `Row ${index + 2}: Missing required fields (Patient ID, Test Code, or Result)`,
          );
          return;
        }

        results.push(resultObj);
      } catch (err) {
        errors.push(
          `Row ${index + 2}: ${err instanceof Error ? err.message : 'Parse error'}`,
        );
      }
    });

    return {
      success: errors.length < jsonData.length,
      data: results,
      errors,
      totalRows: jsonData.length,
      parsedRows: results.length,
    };
  } catch (error) {
    return {
      success: false,
      data: [],
      errors: [error instanceof Error ? error.message : 'Excel parse error'],
      totalRows: 0,
      parsedRows: 0,
    };
  }
}

/**
 * Parse CSV file buffer for laboratory/radiology results
 */
export function parseCSVResults(buffer: Buffer): FileImportResult {
  const csvString = buffer.toString('utf-8');
  const results: ParsedResult[] = [];
  const errors: string[] = [];

  const parsed = Papa.parse(csvString, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors && parsed.errors.length > 0) {
    parsed.errors.forEach((e) => {
      errors.push(`CSV Syntax error: ${e.message}`);
    });
  }

  const parsedData = parsed.data;
  const totalRows = parsedData.length;

  parsedData.forEach((rowRaw: unknown, index: number) => {
    try {
      const row = rowRaw as Record<
        string,
        string | number | boolean | Date | null | undefined
      >;

      const rawPatientId =
        row['Patient ID'] ??
        row['MRN'] ??
        row['patient_id'] ??
        row['PatientID'] ??
        '';
      const patientId = String(rawPatientId).trim();

      const rawPatientName =
        row['Patient Name'] ??
        row['PatientName'] ??
        row['patient_name'] ??
        undefined;
      const patientName = rawPatientName ? String(rawPatientName) : undefined;

      const rawTestCode =
        row['Test Code'] ?? row['TestCode'] ?? row['test_code'] ?? '';
      const testCode = String(rawTestCode).trim();

      const rawTestName =
        row['Test Name'] ?? row['TestName'] ?? row['test_name'] ?? undefined;
      const testName = rawTestName ? String(rawTestName) : undefined;

      const rawResult =
        row['Result'] ?? row['Value'] ?? row['result'] ?? row['value'] ?? '';
      const result = String(rawResult).trim();

      const rawUnit = row['Unit'] ?? row['Units'] ?? row['unit'] ?? undefined;
      const unit = rawUnit ? String(rawUnit) : undefined;

      const rawRefRange =
        row['Reference Range'] ??
        row['ReferenceRange'] ??
        row['reference_range'] ??
        undefined;
      const referenceRange = rawRefRange ? String(rawRefRange) : undefined;

      const rawStatus = row['Status'] ?? row['status'] ?? undefined;
      const status = rawStatus ? String(rawStatus) : undefined;

      const resultObj: ParsedResult = {
        patientId,
        patientName,
        testCode,
        testName,
        result,
        unit,
        referenceRange,
        status,
      };

      const dateValue =
        row['Date'] ??
        row['Timestamp'] ??
        row['date'] ??
        row['timestamp'] ??
        undefined;
      if (dateValue) {
        resultObj.timestamp = new Date(String(dateValue));
      }

      if (!resultObj.patientId || !resultObj.testCode || !resultObj.result) {
        errors.push(`Row ${index + 2}: Missing required fields`);
        return;
      }

      results.push(resultObj);
    } catch (err) {
      errors.push(
        `Row ${index + 2}: ${err instanceof Error ? err.message : 'Parse error'}`,
      );
    }
  });

  return {
    success: errors.length < totalRows,
    data: results,
    errors,
    totalRows,
    parsedRows: results.length,
  };
}

/**
 * Parse file buffer based on extension
 */
export function parseResultsFile(
  buffer: Buffer,
  originalname: string,
): FileImportResult {
  const extension = originalname.split('.').pop()?.toLowerCase();

  if (extension === 'csv') {
    return parseCSVResults(buffer);
  } else if (extension === 'xlsx' || extension === 'xls') {
    return parseExcelResults(buffer);
  } else {
    return {
      success: false,
      data: [],
      errors: ['Unsupported file type. Please upload CSV or Excel file.'],
      totalRows: 0,
      parsedRows: 0,
    };
  }
}
