export default function Spinner({ size = 24, center = false }) {
  const style = { width: size, height: size, borderWidth: size > 30 ? 3 : 2.5 };
  if (center) {
    return (
      <div className="loading-center">
        <div className="spinner" style={style} />
      </div>
    );
  }
  return <div className="spinner" style={style} />;
}
