import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CaseTakingService } from './case-taking.service';
import { CaseSubmissionQueryDto } from './dto/case-submission-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { patientScopeFor } from '../../common/guards/patient-self.guard';
import { Permission } from '../../common/enums/permission.enum';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The finished intake, read by the clinician it was written for
 *
 * `CaseTakingController` is the patient's side of this feature and every route
 * on it goes through `self()`: a live interview belongs to the person having
 * it, and a staff caller — who has no patient id anywhere in those URLs — is
 * refused rather than defaulted. Its header has always ended that argument
 * with "a clinician reads a finished intake through the submission on the
 * patient record". **That route did not exist.** The document was rendered,
 * written whole and attached to the record, and nothing in the API could open
 * it. This is it.
 *
 * ## Why a second controller rather than two more routes over there
 *
 * `PatientSelfGuard` is mounted on that class, and it is mounted deliberately:
 * it rewrites any `patientId` or `id` in the request to the caller's own. That
 * is exactly right for a patient-scoped route and exactly wrong here — a
 * doctor reading Ifeoma Balogun's intake would have the id rewritten to their
 * own (absent) patient record and get a 403 for a chart they are entitled to
 * read. Guards are per class, so the honest way to have both behaviours is two
 * classes.
 *
 * ## What is read and what is refused
 *
 * Gated on `CASE_TAKING_READ`, which the seed grants a doctor and a nurse and
 * nothing more — no create, no update. That grant is not an oversight, it is
 * the feature: **an intake a clinician can rewrite stops being evidence of
 * what the patient said.** There is deliberately no PATCH here and no route
 * that could produce one.
 *
 * A patient's own token reaches these routes too, because the portal role
 * holds the read. `patientScopeFor` narrows them to their own rows — so the
 * listing cannot become a way to page through the hospital's intakes with a
 * patient login, which is the mistake `GET /appointments` made once already.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@ApiTags('Case Taking')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('case-taking/submissions')
export class CaseSubmissionsController {
  constructor(private readonly caseTakingService: CaseTakingService) {}

  @Get()
  @Permissions(Permission.CASE_TAKING_READ)
  @ApiOperation({
    summary: 'Intakes patients have sent in, newest first',
    description:
      'Filter by `patientId` to read one chart; omit it for everything this ' +
      'site has been sent. A patient caller is narrowed to their own rows ' +
      'whatever they ask for.',
  })
  async findAll(
    @Query() query: CaseSubmissionQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    // Applied here rather than trusted from the query, because a
    // client-supplied `patientId` is the thing being defended against.
    const scope = patientScopeFor(currentUser);

    return this.caseTakingService.listSubmissions(
      {
        patientId: scope ?? query.patientId,
        page: query.page,
        limit: query.limit,
      },
      currentUser,
    );
  }

  @Get(':submissionId')
  @Permissions(Permission.CASE_TAKING_READ)
  @ApiParam({ name: 'submissionId', type: String })
  @ApiOperation({
    summary: 'One intake, as it was sent',
    description:
      'The stored document, never re-rendered: the session keeps moving after ' +
      'a submission, and what the doctor opened must stay what the patient ' +
      'sent. The safety block carries the rules that fired, which the ' +
      "patient's own view of the same case does not.",
  })
  async findOne(
    @Param('submissionId') submissionId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.caseTakingService.readSubmission(
      submissionId,
      currentUser,
      patientScopeFor(currentUser),
    );
  }
}
