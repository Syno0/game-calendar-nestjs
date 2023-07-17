import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
  ) {}

  async validateUser(username: string, password: string): Promise<any> {

	// Get login information

	// Exemple with DB USER
    // const user = await this.usersService.getUser({ username });
    // if (!user)
	// 	throw new NotAcceptableException('could not find the user');

    // const passwordValid = await bcrypt.compare(password, user.password);

    // if (passwordValid){
	// 	// return user
	// 	return {
	// 		login: 'Hello there'
	// 	}
	// }

	const passwordValid = await bcrypt.compare(password, process.env.BCRYPT_USER_PWD);
	if(username === 'game_calendar_user' && passwordValid)
		return {
			username
		};

    return null;
  }

  async login(user: any) {
    const payload = { username: user.username, sub: user._id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
