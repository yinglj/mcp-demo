import { createLogger, transports, format } from "winston";

export const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.File({ filename: "audit.log" }),
    new transports.Console(),
  ],
});