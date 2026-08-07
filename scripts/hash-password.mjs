import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error("Podaj hasło mające co najmniej 10 znaków.");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
console.log(
  `scrypt.${salt.toString("base64url")}.${hash.toString("base64url")}`,
);
