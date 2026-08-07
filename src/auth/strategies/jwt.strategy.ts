import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

export interface JwtPayload{
    sub : string;   // userId (standard JWT claim name)
    email : string;
    role : string;
}
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      // Where to find the token: in the Authorization header as "Bearer <token>"
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Reject expired tokens automatically
      ignoreExpiration: false,
      // The secret key used to verify the token signature
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // This method is called AFTER the token signature is verified
  // The payload is the decoded JWT data
  // Whatever we return here gets attached to request.user
  async validate(payload: JwtPayload) {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  }
}