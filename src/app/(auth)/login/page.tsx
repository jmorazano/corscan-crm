import { safeNextPath } from "@/lib/oauth-server/next-path";
import { LoginForm } from "./login-form";

type Props = { searchParams: Promise<{ reset?: string; next?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { reset, next } = await searchParams;
  return <LoginForm passwordReset={reset === "1"} next={safeNextPath(next)} />;
}
