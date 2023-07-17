import { Controller, Request, Response, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';

@Controller()
export class AuthController {
    constructor(private authService: AuthService) { }

    @UseGuards(AuthGuard('local'))
    @Post('auth/login')
    async login(@Request() req, @Response() res) {
        const {access_token} = await this.authService.login(req.user);
        // Set JWT token in client cookie
        res.cookie('access_token', access_token, {
            expires: new Date(Date.now() + 360000 + 0.1), // 10min to match JWT token expiration
            httpOnly: true,
            secure: true,
            sameSite: 'strict'
        })
        return res.send(true);
    }
}