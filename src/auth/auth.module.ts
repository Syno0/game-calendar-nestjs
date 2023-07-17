import { Module } from "@nestjs/common"
import { AuthService } from "./auth.service"
import { PassportModule } from "@nestjs/passport"
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './strategies/local.auth';
import { JwtStrategy } from './strategies/jwt.auth';

// Fix "secretOrPrivateKey must have a value"
// https://dev.to/emmanuelthecoder/how-to-solve-secretorprivatekey-must-have-a-value-in-nodejs-4mpg
import * as dotenv from 'dotenv';
dotenv.config();


@Module({
  imports: [PassportModule, JwtModule.register({
    secret: process.env.JWT_KEY,
    signOptions: { expiresIn: '600s' }, // 10min expire
  })],
  providers: [AuthService, LocalStrategy, JwtStrategy],
  controllers: [AuthController],
})
export class AuthModule { }