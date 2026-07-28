"use client";

export function Footer() {
  return (
    <footer style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
      padding: "12px 24px",
      background: "#f9fafb",
      borderTop: "1px solid #e5e7eb",
      textAlign: "center",
    }}>
      <span style={{ fontSize: 13, color: "#636a78" }}>
        BitGraph — Patent Pending
      </span>
    </footer>
  );
}
