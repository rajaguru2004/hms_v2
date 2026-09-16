import { Module } from '@nestjs/common';
import { CaseTakingController } from './case-taking.controller';
import { CaseTakingService } from './case-taking.service';
import { CaseTakingRepository } from './case-taking.repository';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';

/**
 * The patient's intake.
 *
 * `AiModule` is imported rather than the provider being constructed here, so
 * that the medical-document stream gets the same extraction rules, the same
 * sidecar breaker and the same drug matcher from the same instances. Two copies
 * of the extraction rules is one copy that grows a `presence` field back.
 *
 * Nothing in `engine/` is a Nest provider and nothing here makes one of it. The
 * engine is pure functions over data: no injection, no lifecycle, no clock, and
 * therefore a safety evaluation that can be replayed exactly a year later.
 *
 * `AuthModule` is here for the one thing it re-exports: `JwtModule`, and so
 * `JwtService`. `voiceToken` mints a short-lived credential for the voice
 * worker to post the patient's turns with, and it must be signed with the same
 * secret and the same claim shape `JwtStrategy` validates — importing the
 * module that already owns that configuration is what keeps the two from
 * drifting into a token this API would reject as its own.
 */
@Module({
  imports: [AiModule, AuthModule],
  controllers: [CaseTakingController],
  providers: [CaseTakingService, CaseTakingRepository],
  exports: [CaseTakingService, CaseTakingRepository],
})
export class CaseTakingModule {}
