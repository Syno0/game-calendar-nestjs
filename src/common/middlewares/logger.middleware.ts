import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Display minimal information
    if (req.method == 'POST' && req.body)
      console.log(
        `${req.method} ${req.originalUrl} - ${res.statusCode}\n${JSON.stringify(req.body)}`,
      );
    else console.log(`${req.method} ${req.originalUrl} - ${res.statusCode}`);

    // Display full information
    // console.log({
    //   headers: req.headers,
    //   originalUrl: req.originalUrl,
    //   body: req.body,
    //   query: req.query,
    // });

    // Ends middleware function execution, hence allowing to move on
    if (next) next();
  }
}
