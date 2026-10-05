import { ImageResponse } from "next/og";

// Home-screen icon: a red khata cover with a ruled page edge.
export async function GET(_: Request, ctx: RouteContext<"/app-icon/[size]">) {
  const { size: raw } = await ctx.params;
  const size = raw === "192" ? 192 : 512;
  const u = size / 512;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#9E1B22", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: 120 * u,
            top: 96 * u,
            width: 272 * u,
            height: 320 * u,
            background: "#F2F5F0",
            borderRadius: 10 * u,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-around",
            paddingLeft: 70 * u,
            paddingRight: 30 * u,
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ height: 6 * u, background: "#C3D5E4", width: "100%" }} />
          ))}
          <div
            style={{ position: "absolute", left: 44 * u, top: 0, bottom: 0, width: 6 * u, background: "#E07070" }}
          />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
