import { Module } from '@nestjs/common';
import { CaseTakingController } from './case-taking.controller';
import { CaseTakingService } from './case-taking.service';
import { CaseTakingRepository } from './case-taking.repository';
import { AiModule } from '../ai/ai.module';

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
 */
@Module({
  imports: [AiModule],
  controllers: [CaseTakingController],
  providers: [CaseTakingService, CaseTakingRepository],
  exports: [CaseTakingService, CaseTakingRepository],
})
export class CaseTakingModule {}
