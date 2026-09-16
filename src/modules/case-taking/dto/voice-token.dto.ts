import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { IsLanguageCode } from '../../../common/decorators/language.decorator';

/**
 * A request for a pass into the patient's live voice room.
 *
 * ## What the client is NOT allowed to say
 *
 * It names no room and no participant identity. Both are derived on the server
 * from the session this patient already owns, because a client that could name
 * its own room could name somebody else's: two patients in one room is two
 * clinical interviews in one audio stream, and there is no recovering from
 * that after the fact.
 *
 * The languages are accepted but advisory — the session is the authority, the
 * same rule `/tts` and `/stt` already follow. They are here so the agent that
 * joins the room can be told which language to listen for without a second
 * round trip.
 */
export class VoiceTokenDto {
  @ApiProperty({
    description:
      'The interview this room belongs to. The room name and the participant ' +
      'identity are both derived from it, server-side.',
  })
  @IsString()
  @MaxLength(64)
  sessionId!: string;

  @ApiProperty({
    required: false,
    description:
      "Advisory. The session's own input language decides what the " +
      'recogniser is told; this is sent so the agent needs no extra call.',
  })
  @IsOptional()
  @IsLanguageCode('stt')
  inputLanguage?: string;

  @ApiProperty({
    required: false,
    description:
      "Advisory. The session's own output language decides what is spoken — " +
      'English on every session today.',
  })
  @IsOptional()
  @IsLanguageCode('tts')
  outputLanguage?: string;
}

/**
 * The pass itself.
 *
 * **There is no `apiKey` and no `apiSecret` here, and there must never be.**
 * The secret mints this token on the server and stays there. What the phone
 * receives is a short-lived, narrowly-scoped credential for one room — so a
 * decompiled APK yields, at worst, a pass that has already expired to a room
 * whose interview is over.
 */
export class VoiceGrantDto {
  @ApiProperty({ description: 'The room token. Short-lived; see `expiresAt`.' })
  token!: string;

  @ApiProperty({
    description: 'The LiveKit server to dial. `wss://…`, from configuration.',
  })
  url!: string;

  @ApiProperty({
    description:
      'The room this token admits its holder to, derived from the session.',
  })
  roomName!: string;

  @ApiProperty({
    description: 'When the token stops working, as an ISO-8601 instant.',
  })
  expiresAt!: string;
}
