import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Declared so `forbidNonWhitelisted` accepts the parameter at all.
 *
 * `narrative` is opt-in rather than the default because drafting the prose
 * read-back costs a model call, and on this hardware that is eight to twenty
 * seconds. The structured review document — which is the part §34 actually
 * requires — is rendered by the engine and comes back immediately either way.
 */
export class ReviewQueryDto {
  @ApiPropertyOptional({
    description:
      'Also draft a prose read-back of the review. Costs a model call; the ' +
      'structured document is returned immediately regardless.',
    default: false,
  })
  @IsOptional()
  // `enableImplicitConversion` turns "true" into a boolean for a declared
  // boolean, but a bare `?narrative` arrives as an empty string; this makes
  // both spellings mean the same thing rather than one of them being a 400.
  @Transform(({ value }) => value === true || value === 'true' || value === '')
  @IsBoolean()
  narrative?: boolean;
}
