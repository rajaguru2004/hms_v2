import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsBoolean,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRoleDto {
  @ApiProperty({ example: 'custom_receptionist' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    example: 'Custom role with limited receptionist access',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'org-demo' })
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: 'custom_receptionist_v2' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class PermissionAssignmentDto {
  @ApiProperty({ example: 'permission-cuid' })
  @IsString()
  @IsNotEmpty()
  permissionId: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  canRead: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  canUpdate: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  canCreate: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  canDelete: boolean;
}

export class AssignPermissionsDto {
  @ApiProperty({ type: [PermissionAssignmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionAssignmentDto)
  permissions: PermissionAssignmentDto[];
}

export class AssignUserRoleDto {
  @ApiProperty({ example: 'user-cuid' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}
