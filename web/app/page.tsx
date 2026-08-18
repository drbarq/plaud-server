import { currentUser } from "@/lib/auth";
import { listRecordings, health, listLinks } from "@/lib/queries";
import { Workstation } from "@/components/workstation";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const [recordings, h, links] = await Promise.all([listRecordings(), health(), listLinks()]);
  return <Workstation recordings={recordings} health={h} links={links} />;
}
