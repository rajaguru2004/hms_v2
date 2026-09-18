import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  SpeakDto,
  StartCaseSessionDto,
  TranscribeDto,
} from './case-taking.dto';

/**
 * What a language does on the way in.
 *
 * Driven through `plainToInstance` then `validateSync`, which is exactly what
 * the global `ValidationPipe` does and in that order — transform first, then
 * validate. Testing the decorators rather than a running Nest app is the point:
 * the ordering is the thing that can break, and it breaks silently. A
 * `@Transform` that stopped running would make `ta-IN` a 400, and the bug would
 * look like a broken phone rather than a broken pipe.
 */

interface Outcome {
  readonly value: string | undefined;
  readonly errors: readonly string[];
}

function check<T extends object>(
  Dto: new () => T,
  body: Record<string, unknown>,
): Outcome {
  const instance = plainToInstance(Dto, body);
  const failures = validateSync(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return {
    value: (instance as { language?: string }).language,
    errors: failures.flatMap((failure) =>
      Object.values(failure.constraints ?? {}),
    ),
  };
}

describe('StartCaseSessionDto.language', () => {
  it.each([
    ['ta-IN', 'ta'],
    ['ta_IN', 'ta'],
    ['TA', 'ta'],
    ['hi-IN', 'hi'],
    ['or', 'or'],
    ['en', 'en'],
  ])('accepts %s and stores it as %s', (sent, stored) => {
    const outcome = check(StartCaseSessionDto, { language: sent });
    expect(outcome.errors).toEqual([]);
    expect(outcome.value).toBe(stored);
  });

  it('accepts all eleven Indic languages plus English', () => {
    for (const code of [
      'en',
      'as',
      'bn',
      'gu',
      'hi',
      'kn',
      'ml',
      'mr',
      'or',
      'pa',
      'ta',
      'te',
    ]) {
      expect(check(StartCaseSessionDto, { language: code }).errors).toEqual([]);
    }
  });

  /**
   * The whole point. A language we do not have used to be stored verbatim and
   * then quietly become English at the sidecar; now it is a refusal the caller
   * can read.
   */
  it('refuses a language we do not have, with a sentence rather than a code', () => {
    const outcome = check(StartCaseSessionDto, { language: 'fr' });
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toMatch(/We do not support that language/);
    expect(outcome.errors[0]).toContain('ta');
  });

  it('refuses an empty language rather than reading it as absent', () => {
    expect(check(StartCaseSessionDto, { language: '' }).errors).toHaveLength(1);
  });

  it('leaves an omitted language absent, for the service to default', () => {
    const outcome = check(StartCaseSessionDto, {});
    expect(outcome.errors).toEqual([]);
    expect(outcome.value).toBeUndefined();
  });

  /**
   * `or` belongs here even though its microphone does not. An Odia patient
   * whose questions are read aloud and whose answers are typed has had a
   * complete interview.
   */
  it('offers Odia for the interview even though it cannot be transcribed', () => {
    expect(check(StartCaseSessionDto, { language: 'or' }).errors).toEqual([]);
    expect(check(TranscribeDto, { language: 'or' }).errors).toHaveLength(1);
  });
});

describe('TranscribeDto.language', () => {
  it('normalises a region tag from the phone', () => {
    const outcome = check(TranscribeDto, { language: 'ta-IN' });
    expect(outcome.errors).toEqual([]);
    expect(outcome.value).toBe('ta');
  });

  it('refuses Odia, and says why and what to do instead', () => {
    const outcome = check(TranscribeDto, { language: 'or' });
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toMatch(/no Odia speech model exists/);
    expect(outcome.errors[0]).toMatch(/typed rather than spoken/);
  });

  it('still allows an omitted language, which means "detect it"', () => {
    expect(check(TranscribeDto, {}).errors).toEqual([]);
  });
});

describe('SpeakDto.language', () => {
  it('normalises and accepts a language that can be read aloud', () => {
    const outcome = check(SpeakDto, { text: 'hello', language: 'ta-IN' });
    expect(outcome.errors).toEqual([]);
    expect(outcome.value).toBe('ta');
  });

  it('accepts Odia, which has a voice even though it has no recogniser', () => {
    expect(check(SpeakDto, { text: 'hello', language: 'or' }).errors).toEqual(
      [],
    );
  });

  it('refuses a language we cannot speak', () => {
    const outcome = check(SpeakDto, { text: 'hello', language: 'fr' });
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toMatch(/reading aloud/);
  });
});

describe('the session id on the voice routes', () => {
  /**
   * Additive: a client that has never heard of `sessionId` keeps working. It
   * has to be declared all the same, because `forbidNonWhitelisted` would 400
   * an undeclared field — including on a multipart upload.
   */
  it('is optional on both', () => {
    expect(check(SpeakDto, { text: 'hello' }).errors).toEqual([]);
    expect(check(TranscribeDto, {}).errors).toEqual([]);
  });

  it('is accepted on both', () => {
    expect(
      check(SpeakDto, { text: 'hello', sessionId: 'sess-1' }).errors,
    ).toEqual([]);
    expect(check(TranscribeDto, { sessionId: 'sess-1' }).errors).toEqual([]);
  });
});
