export function CompassOrb({ size = 168 }: { size?: number }) {
  return (
    <div
      className="relative mx-auto"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 32% 28%, #ffffff 0%, #f4f6f5 32%, #dfe6e2 62%, #cfd9d3 100%)",
          boxShadow:
            "inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -14px 24px rgba(120,140,132,0.18), 0 20px 40px -12px rgba(31,122,77,0.22)",
        }}
      />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 68% 76%, rgba(120,170,230,0.35), transparent 55%)",
        }}
      />
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0"
        style={{ width: "48%", height: "48%", top: "26%", left: "26%" }}
      >
        <path
          d="M72 28 L46 46 L28 72 L54 54 Z"
          fill="#14130f"
        />
        <path
          d="M72 28 L54 54 L46 46 Z"
          fill="#3a3934"
        />
      </svg>
    </div>
  );
}
