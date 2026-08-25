export default function Loading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#022c22",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          border: "3px solid rgba(52, 211, 153, 0.2)",
          borderTopColor: "rgb(52, 211, 153)",
          borderRadius: "50%",
          animation: "kavach-spin 1s linear infinite",
        }}
      />
      <style>{`@keyframes kavach-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
