import {
  ApiHealthResponse,
  ExplanationResponse,
  ProfileListResponse,
  RunDetail,
  RunListResponse,
  ScenarioRunDetail,
  SuiteSummary,
} from "@crash-test/shared";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getJson } from "./client";

// Shared has no suites-list schema; derive one from shared schemas instead of importing zod here.
const SuiteListResponse = RunListResponse.omit({ runs: true }).extend({
  suites: SuiteSummary.array(),
});

const enc = encodeURIComponent;
const isActive = (d: RunDetail | undefined) =>
  d?.run.status === "queued" || d?.run.status === "running";

export const useHealth = () =>
  useQuery({
    queryKey: ["health"],
    queryFn: () => getJson("/api/health", ApiHealthResponse),
    staleTime: 30_000,
  });

export const useRuns = () =>
  useQuery({
    queryKey: ["runs"],
    queryFn: () => getJson("/api/runs", RunListResponse),
  });

const runQuery = (id: string) => ({
  queryKey: ["run", id],
  queryFn: () => getJson(`/api/runs/${enc(id)}`, RunDetail),
});

/** Polls while the run is active, as a fallback if the SSE stream drops. */
export const useRun = (id: string) =>
  useQuery({
    ...runQuery(id),
    refetchInterval: (q) => (isActive(q.state.data) ? 5_000 : false),
  });

export const useRunDetails = (ids: string[]) =>
  useQueries({ queries: ids.map(runQuery) });

export const useScenarioRun = (id: string | null) =>
  useQuery({
    queryKey: ["scenario-run", id],
    queryFn: () =>
      getJson(`/api/scenario-runs/${enc(id ?? "")}`, ScenarioRunDetail),
    enabled: id !== null,
  });

/** Refetched on `judge.ready` (useRunStream); polls while pending as a fallback. */
export const useExplanation = (id: string) =>
  useQuery({
    queryKey: ["explanation", id],
    queryFn: () =>
      getJson(`/api/scenario-runs/${enc(id)}/explanation`, ExplanationResponse),
    refetchInterval: (q) =>
      q.state.data?.status === "pending" ? 5_000 : false,
  });

export const useProfiles = () =>
  useQuery({
    queryKey: ["profiles"],
    queryFn: () => getJson("/api/profiles", ProfileListResponse),
  });

export const useSuites = () =>
  useQuery({
    queryKey: ["suites"],
    queryFn: () => getJson("/api/suites", SuiteListResponse),
    staleTime: Infinity,
  });
