import { PrismaService } from '../prisma.service';
import {
  PaginatedResult,
  PaginationMeta,
} from '../../common/types/paginated.type';

// Prisma delegate interface — minimal shape needed for generic repository
interface PrismaDelegate {
  findFirst: (args: Record<string, unknown>) => Promise<unknown>;
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  create: (args: Record<string, unknown>) => Promise<unknown>;
  update: (args: Record<string, unknown>) => Promise<unknown>;
  delete: (args: Record<string, unknown>) => Promise<unknown>;
  count: (args: Record<string, unknown>) => Promise<number>;
}

/**
 * BaseRepository<TModel, TCreateInput, TUpdateInput>
 *
 * Generic repository providing standard CRUD + soft delete + pagination.
 *
 * Architecture decision: Repository pattern sits between Service and Prisma.
 * Services call Repository methods only — never call prisma directly from services.
 *
 * This enforces:
 * - Consistent soft-delete behaviour
 * - Centralized query patterns
 * - Easy mocking in unit tests (mock repository, not Prisma)
 *
 * Type parameters:
 *   TModel       — The Prisma model type (e.g., User from @prisma/client)
 *   TCreateInput — Prisma create input type
 *   TUpdateInput — Prisma update input type
 *
 * Concrete repos extend this and provide the `modelName` string.
 * Example: UserRepository extends BaseRepository<User, Prisma.UserCreateInput, Prisma.UserUpdateInput>
 */
export abstract class BaseRepository<TModel, TCreateInput, TUpdateInput> {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly modelName: string, // matches Prisma delegate key e.g. 'user'
  ) {}

  // Typed delegate accessor — gets the Prisma delegate for the model
  protected get delegate(): PrismaDelegate {
    return (this.prisma as unknown as Record<string, PrismaDelegate>)[
      this.modelName
    ];
  }

  /**
   * Find by primary key.
   * Excludes soft-deleted records by default.
   */
  async findById(id: string, includeDeleted = false): Promise<TModel | null> {
    return this.delegate.findFirst({
      where: {
        id,
        ...(!includeDeleted && { isDeleted: false }),
      },
    }) as Promise<TModel | null>;
  }

  /**
   * Find multiple records with optional filters.
   * Always excludes soft-deleted unless explicitly included.
   */
  async findMany(
    where: Record<string, unknown> = {},
    options: {
      include?: Record<string, unknown>;
      orderBy?: Record<string, 'asc' | 'desc'>;
      includeDeleted?: boolean;
    } = {},
  ): Promise<TModel[]> {
    const { include, orderBy, includeDeleted = false } = options;

    return this.delegate.findMany({
      where: {
        ...where,
        ...(!includeDeleted && { isDeleted: false }),
      },
      ...(include && { include }),
      ...(orderBy && { orderBy }),
    }) as Promise<TModel[]>;
  }

  /**
   * Find a single record by arbitrary where clause.
   */
  async findOne(
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<TModel | null> {
    return this.delegate.findFirst({
      where: { ...where, isDeleted: false },
      ...(include && { include }),
    }) as Promise<TModel | null>;
  }

  /**
   * Create a new record.
   */
  async create(data: TCreateInput): Promise<TModel> {
    return this.delegate.create({ data }) as Promise<TModel>;
  }

  /**
   * Update a record by ID.
   * Also sets updatedBy if provided.
   */
  async update(
    id: string,
    data: TUpdateInput & { updatedBy?: string },
  ): Promise<TModel> {
    return this.delegate.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    }) as Promise<TModel>;
  }

  /**
   * Hard delete — use only when legally required (e.g., GDPR right to erasure).
   * Prefer softDelete for all normal operations.
   */
  async hardDelete(id: string): Promise<TModel> {
    return this.delegate.delete({ where: { id } }) as Promise<TModel>;
  }

  /**
   * Soft delete — sets isDeleted=true, deletedAt=now.
   * Records remain in DB for audit trail.
   */
  async softDelete(id: string, deletedBy?: string): Promise<TModel> {
    return this.delegate.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        ...(deletedBy && { updatedBy: deletedBy }),
      },
    }) as Promise<TModel>;
  }

  /**
   * Restore a soft-deleted record.
   */
  async restore(id: string, restoredBy?: string): Promise<TModel> {
    return this.delegate.update({
      where: { id },
      data: {
        isDeleted: false,
        deletedAt: null,
        ...(restoredBy && { updatedBy: restoredBy }),
      },
    }) as Promise<TModel>;
  }

  /**
   * Paginate — returns data + pagination meta.
   * All list endpoints should use this for consistency.
   */
  async paginate(
    where: Record<string, unknown> = {},
    options: {
      page?: number;
      limit?: number;
      include?: Record<string, unknown>;
      orderBy?:
        | Record<string, 'asc' | 'desc'>
        | Record<string, 'asc' | 'desc'>[];
      includeDeleted?: boolean;
    } = {},
  ): Promise<PaginatedResult<TModel>> {
    const {
      page = 1,
      limit = 10,
      include,
      orderBy = { createdAt: 'desc' },
      includeDeleted = false,
    } = options;

    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

    const whereClause = {
      ...where,
      ...(!includeDeleted && { isDeleted: false }),
    };

    const [data, total] = await Promise.all([
      this.delegate.findMany({
        where: whereClause,
        skip,
        take: safeLimit,
        ...(include && { include }),
        orderBy,
      }) as Promise<TModel[]>,
      this.delegate.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(total / safeLimit);

    const meta: PaginationMeta = {
      page,
      limit: safeLimit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };

    return { data, meta };
  }

  /**
   * Count records matching where clause.
   */
  async count(
    where: Record<string, unknown> = {},
    includeDeleted = false,
  ): Promise<number> {
    return this.delegate.count({
      where: {
        ...where,
        ...(!includeDeleted && { isDeleted: false }),
      },
    });
  }
}
