import { getAuth } from "@/lib/auth";
import { withClientIp } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return getAuth().handler(withClientIp(req));
}

export async function POST(req: Request) {
  return getAuth().handler(withClientIp(req));
}
