import { Request, Response, NextFunction } from 'express';
import { APIKey } from '../services/apiKeys';
declare global {
    namespace Express {
        interface Request {
            apiKey?: APIKey;
        }
    }
}
export declare function apiKeyAuth(req: Request, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;
export declare function optionalApiKeyAuth(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=apiKeyAuth.d.ts.map