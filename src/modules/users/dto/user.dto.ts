import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
} from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'john.doe@hospital.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass@123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'org_cuid_here' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({ example: '1990-05-15' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 'male' })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({ example: '123 Main St' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'EMP123' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ example: 'DOCTOR' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ example: 'dept_cuid_here' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ example: 'Cardiology' })
  @IsOptional()
  @IsString()
  specialization?: string;

  @ApiPropertyOptional({ example: 'LIC9876' })
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @ApiPropertyOptional({ example: 'ethiopian' })
  @IsOptional()
  @IsString()
  defaultCalendar?: string;
}

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password', 'email']),
) {}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  newPassword: string;
}

export class UserResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() organizationId: string;
  @ApiProperty() email: string;
  @ApiProperty() fullName: string;
  @ApiPropertyOptional() firstName?: string;
  @ApiPropertyOptional() lastName?: string;
  @ApiPropertyOptional() phone?: string;
  @ApiProperty() isActive: boolean;
  @ApiPropertyOptional() lastLoginAt?: Date;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiPropertyOptional() dateOfBirth?: Date;
  @ApiPropertyOptional() gender?: string;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional() employeeId?: string;
  @ApiPropertyOptional() role?: string;
  @ApiPropertyOptional() departmentId?: string;
  @ApiPropertyOptional() specialization?: string;
  @ApiPropertyOptional() licenseNumber?: string;
  @ApiPropertyOptional() defaultCalendar?: string;
}
