import { LoginForm } from "./login-form";

type Props = { searchParams: Promise<{ reset?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { reset } = await searchParams;
  return <LoginForm passwordReset={reset === "1"} />;
}
