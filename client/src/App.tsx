import { Compass } from "lucide-react";
import { lazy, Suspense } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Button, Card, EmptyState, Loading } from "./components/ui";

// Each page is its own chunk, so the first load only downloads what it shows.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Studio = lazy(() => import("./pages/Studio"));
const TestLab = lazy(() => import("./pages/TestLab"));
const Failures = lazy(() => import("./pages/Failures"));
const Optimizer = lazy(() => import("./pages/Optimizer"));
const Compare = lazy(() => import("./pages/Compare"));
const History = lazy(() => import("./pages/History"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));

function NotFound() {
  const navigate = useNavigate();
  return (
    <Card>
      <EmptyState icon={<Compass size={26} />} title="Page not found" action={<Button variant="primary" onClick={() => navigate("/")}>Back to dashboard</Button>}>
        The page you are looking for does not exist.
      </EmptyState>
    </Card>
  );
}

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/tests" element={<TestLab />} />
          <Route path="/failures" element={<Failures />} />
          <Route path="/optimizer" element={<Optimizer />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/history" element={<History />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
