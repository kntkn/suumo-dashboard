export async function GET() {
  // Slots are managed in server.js in-memory
  // This route proxies to the express endpoint
  try {
    const res = await fetch("http://localhost:3000/api/slots");
    const data = await res.json();
    return Response.json(data);
  } catch {
    return Response.json([], { status: 500 });
  }
}
