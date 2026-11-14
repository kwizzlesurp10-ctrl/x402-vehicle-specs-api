import unzipper from "unzipper";

export type DownloadResult = {
  csvText: string;
  retrievedAt: string;
};

export async function downloadZipCsv(url: string): Promise<DownloadResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const directory = await unzipper.Open.buffer(buffer);
  const csvEntry = directory.files.find((f) => f.path.endsWith(".csv"));
  if (!csvEntry) {
    throw new Error(`No CSV found in zip from ${url}`);
  }
  const csvText = (await csvEntry.buffer()).toString("utf8");
  const retrievedAt = new Date().toISOString();
  return { csvText, retrievedAt };
}
