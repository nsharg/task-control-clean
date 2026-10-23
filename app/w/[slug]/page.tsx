import { redirect } from "next/navigation";

export default async function Page({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  redirect(`/w/${slug}/my-work`);
}
