import { DocumentLlm } from '../llm/document-llm.port';
import {
  clean,
  cleanList,
  extractDocument,
  normaliseExtraction,
} from './extractor';

describe('disbelieving the model, in specific ways', () => {
  it('turns a written placeholder back into the null the schema offered', () => {
    expect(clean('N/A')).toBeNull();
    expect(clean('not mentioned')).toBeNull();
    expect(clean('  ')).toBeNull();
    expect(clean('None')).toBeNull();
    expect(clean('Metformin')).toBe('Metformin');
  });

  it('keeps a number, because a lab result often is one', () => {
    expect(clean(11.2)).toBe('11.2');
    expect(clean(0)).toBe('0');
  });

  it('does not eat a placeholder that is really a value', () => {
    // Whole-string matching, not substring: these are things documents say.
    expect(clean('Nil by mouth from midnight')).toBe(
      'Nil by mouth from midnight',
    );
    expect(clean('None of the above')).toBe('None of the above');
  });

  it('drops "None" out of a list rather than recording it as an item', () => {
    expect(cleanList(['None', 'Penicillin', 'n/a', ''])).toEqual([
      'Penicillin',
    ]);
    expect(cleanList('not an array')).toEqual([]);
  });

  it('drops a medication with no name', () => {
    const result = normaliseExtraction(
      {
        medications: [
          { strength: '500 mg' },
          { name: 'Metformin', uncertain: false },
        ],
      },
      'prescription',
    );

    expect(result.medications).toHaveLength(1);
    expect(result.medications[0].name).toBe('Metformin');
  });

  it('treats an unstated "uncertain" as uncertain', () => {
    // The two errors do not cost the same. A medication needlessly flagged
    // wastes a glance; one wrongly waved through is a dose nobody checked.
    const result = normaliseExtraction(
      { medications: [{ name: 'Metformin' }] },
      'prescription',
    );

    expect(result.medications[0].uncertain).toBe(true);
  });

  it('survives a model that answered with the wrong shape entirely', () => {
    expect(
      normaliseExtraction('a sentence', 'prescription').medications,
    ).toEqual([]);
    expect(normaliseExtraction(null, 'prescription').investigations).toEqual(
      [],
    );
    expect(
      normaliseExtraction({ medications: 'Metformin 500mg' }, 'prescription')
        .medications,
    ).toEqual([]);
  });

  it('collects the prescriber under one name whatever the schema called it', () => {
    expect(
      normaliseExtraction({ prescriber: 'Dr. Raghavan' }, 'prescription')
        .document.author,
    ).toBe('Dr. Raghavan');
    expect(
      normaliseExtraction(
        { treatingPhysician: 'Dr. Menon' },
        'discharge_summary',
      ).document.author,
    ).toBe('Dr. Menon');
  });

  it('only builds an admission when the document gave a date for one', () => {
    expect(normaliseExtraction({}, 'discharge_summary').admission).toBeNull();
    expect(
      normaliseExtraction({ dischargedOn: '2026-09-12' }, 'discharge_summary')
        .admission,
    ).toEqual({ admittedOn: null, dischargedOn: '2026-09-12' });
  });
});

describe('the extraction call', () => {
  it('sends the type-specific schema and instruction, and truncates the text', async () => {
    const llm = {
      extractJson: jest.fn().mockResolvedValue({ medications: [] }),
      transcribeImage: jest.fn(),
    } as unknown as DocumentLlm;

    await extractDocument('x'.repeat(30_000), 'prescription', llm);

    // The calls array is typed once, at the read, rather than each index being
    // an `any` the lint gate refuses.
    const calls = (llm.extractJson as jest.Mock).mock.calls as Array<
      [{ instruction: string; text: string; schema: { required: string[] } }]
    >;
    const request = calls[0][0];

    expect(request.schema.required).toEqual(['medications']);
    expect(request.instruction).toContain('prescription');
    expect(request.instruction).toContain('return null');
    expect(request.text.length).toBeLessThan(30_000);
  });

  it('never asks the model for a confidence', async () => {
    const llm = {
      extractJson: jest.fn().mockResolvedValue({ investigations: [] }),
      transcribeImage: jest.fn(),
    } as unknown as DocumentLlm;

    await extractDocument('some text', 'laboratory_report', llm);

    const calls = (llm.extractJson as jest.Mock).mock.calls as Array<
      [{ schema: unknown }]
    >;
    const schema = JSON.stringify(calls[0][0].schema);
    expect(schema).not.toContain('confidence');
  });
});
