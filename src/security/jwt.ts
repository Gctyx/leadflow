import { createRemoteJWKSet, exportJWK, importJWK, JWK, JWTHeaderParameters, jwtVerify, SignJWT } from 'jose';
import type { Config } from '../config';

export type JwtKinds = 'access' | 'refresh';

export interface JwtPayloadBase {
  sub: string; // admin_id
  aud: string;
  jti: string;
  roles: string[];
  kind: JwtKinds;
}

export async function buildJwtSigner(cfg: Config) {
  const privateJwk = cfg.ADMIN_JWT_PRIVATE_JWK as JWK;
  if (privateJwk.kty !== 'RSA') throw new Error('ADMIN_JWT_PRIVATE_JWK deve ser RSA');
  const key = await importJWK(privateJwk, 'RS256');
  const kid = (privateJwk as any).kid || 'leadflow-admin';

  async function sign(payload: JwtPayloadBase, ttlSeconds: number): Promise<string> {
    return await new SignJWT(payload as any)
      .setProtectedHeader({ alg: 'RS256', kid } as JWTHeaderParameters)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(key);
  }

  async function verify(token: string) {
    const jwk = await exportJWK(key);
    const jwks = { keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] } as any;
    const rs = createRemoteJWKSet(new URL('data:application/json;base64,' + Buffer.from(JSON.stringify(jwks)).toString('base64')));
    return jwtVerify(token, rs, { audience: cfg.ADMIN_JWT_AUDIENCE });
  }

  async function jwks(): Promise<any> {
    const pub = await exportJWK(key);
    return { keys: [{ ...pub, kid, use: 'sig', alg: 'RS256' }] };
  }

  return { sign, verify, jwks };
}
