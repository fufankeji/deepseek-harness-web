import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  AcceptanceRecord,
  BridgeSessionSummary,
  CommandExecutionResult,
  CommandReceipt,
  DiagnosticSnapshot,
  FileView,
  FilePreview,
  ForkPoint,
  HarnessEvent,
  HarnessCommand,
  ModelInfo,
  RuntimeInfo,
  WorkspaceInfo,
  WorkspacePickerResult,
  WorkspaceSnapshot
} from "./contracts";

export const bridgeApi = createApi({
  reducerPath: "bridgeApi",
  baseQuery: fetchBaseQuery({ baseUrl: "/api" }),
  tagTypes: ["Workspace", "Sessions", "Events", "Diagnostics", "Acceptance", "Commands"],
  endpoints: (builder) => ({
    health: builder.query<{ status: string; version: string; transport: string; persistence: string }, void>({
      query: () => "/health"
    }),
    probeRuntime: builder.mutation<RuntimeInfo, void>({
      query: () => ({ url: "/runtime/probe", method: "POST" })
    }),
    selectRuntime: builder.mutation<RuntimeInfo, { adapterId: "pi" | "deepseek-official" }>({
      query: (body) => ({ url: "/runtime/select", method: "POST", body }),
      invalidatesTags: ["Sessions", "Events", "Diagnostics", "Commands"]
    }),
    getModel: builder.query<ModelInfo, void>({ query: () => "/model" }),
    getModelSources: builder.query<{ configuredFile: boolean }, void>({ query: () => "/model/sources" }),
    selectWorkspace: builder.mutation<WorkspaceInfo, { path: string; projectTrusted: boolean }>({
      query: (body) => ({ url: "/workspaces/select", method: "POST", body }),
      invalidatesTags: ["Workspace", "Sessions", "Events", "Diagnostics", "Commands"]
    }),
    pickWorkspace: builder.mutation<WorkspacePickerResult, void>({
      query: () => ({ url: "/workspaces/pick", method: "POST" }),
      invalidatesTags: (result) => result?.cancelled ? [] : ["Workspace", "Sessions", "Events", "Diagnostics", "Commands"]
    }),
    importWorkspace: builder.mutation<WorkspaceInfo, { url: string }>({
      query: (body) => ({ url: "/workspaces/import", method: "POST", body }),
      invalidatesTags: ["Workspace", "Sessions", "Events", "Diagnostics", "Commands"]
    }),
    createAcceptanceWorkspace: builder.mutation<WorkspaceInfo, { templateVersion?: string } | void>({
      query: (body) => ({ url: "/workspaces/acceptance", method: "POST", body: body ?? {} }),
      invalidatesTags: ["Workspace", "Sessions", "Events", "Diagnostics", "Commands"]
    }),
    createStarterWorkspace: builder.mutation<WorkspaceInfo, { templateVersion?: string } | void>({
      query: (body) => ({ url: "/workspaces/starter", method: "POST", body: body ?? {} }),
      invalidatesTags: ["Workspace", "Sessions", "Events", "Diagnostics", "Commands"]
    }),
    setWorkspaceTrust: builder.mutation<WorkspaceInfo, { projectTrusted: boolean }>({
      query: (body) => ({ url: "/workspaces/trust", method: "POST", body }),
      invalidatesTags: ["Workspace", "Sessions", "Diagnostics", "Commands"]
    }),
    getWorkspace: builder.query<WorkspaceSnapshot, string | void>({
      query: (runId) => runId ? `/workspaces/current?runId=${encodeURIComponent(runId)}` : "/workspaces/current",
      providesTags: ["Workspace"]
    }),
    getFileView: builder.query<FileView, { path: string; runId?: string }>({
      query: ({ path, runId }) => `/workspaces/file-view?path=${encodeURIComponent(path)}${runId ? `&runId=${encodeURIComponent(runId)}` : ""}`,
      providesTags: (_result, _error, { path, runId }) => [{ type: "Workspace", id: `${runId ?? "workspace"}:${path}` }]
    }),
    getFilePreview: builder.query<FilePreview, string>({
      query: (path) => `/workspaces/preview?path=${encodeURIComponent(path)}`,
      providesTags: (_result, _error, path) => [{ type: "Workspace", id: `preview:${path}` }]
    }),
    getSessions: builder.query<{ sessions: BridgeSessionSummary[]; activeSessionId: string | null }, void>({
      query: () => "/sessions",
      providesTags: ["Sessions"]
    }),
    createSession: builder.mutation<BridgeSessionSummary, { name?: string }>({
      query: (body) => ({ url: "/sessions", method: "POST", body }),
      invalidatesTags: ["Sessions", "Events", "Diagnostics", "Commands"]
    }),
    openSession: builder.mutation<BridgeSessionSummary, string>({
      query: (sessionId) => ({ url: `/sessions/${encodeURIComponent(sessionId)}/open`, method: "POST" }),
      invalidatesTags: ["Sessions", "Events", "Diagnostics", "Commands"]
    }),
    closeSession: builder.mutation<BridgeSessionSummary, string>({
      query: (sessionId) => ({ url: `/sessions/${encodeURIComponent(sessionId)}/close`, method: "POST" }),
      invalidatesTags: ["Sessions", "Events", "Diagnostics", "Commands"]
    }),
    deleteSession: builder.mutation<{ deletedSessionId: string }, string>({
      query: (sessionId) => ({ url: `/sessions/${encodeURIComponent(sessionId)}`, method: "DELETE" }),
      invalidatesTags: ["Sessions", "Events", "Diagnostics", "Commands"]
    }),
    renameSession: builder.mutation<BridgeSessionSummary, { sessionId: string; name: string }>({
      query: ({ sessionId, name }) => ({ url: `/sessions/${encodeURIComponent(sessionId)}/name`, method: "POST", body: { name } }),
      invalidatesTags: ["Sessions", "Commands"]
    }),
    getForkPoints: builder.query<{ points: ForkPoint[] }, string>({
      query: (sessionId) => `/sessions/${encodeURIComponent(sessionId)}/fork-points`
    }),
    forkSession: builder.mutation<BridgeSessionSummary, { sessionId: string; entryId: string }>({
      query: ({ sessionId, entryId }) => ({ url: `/sessions/${encodeURIComponent(sessionId)}/fork`, method: "POST", body: { entryId } }),
      invalidatesTags: ["Sessions", "Events", "Diagnostics", "Commands"]
    }),
    getEvents: builder.query<{ events: HarnessEvent[] }, string>({
      query: (sessionId) => `/sessions/${encodeURIComponent(sessionId)}/events`,
      providesTags: ["Events"]
    }),
    getCommands: builder.query<{ commands: HarnessCommand[] }, string>({
      query: (sessionId) => `/sessions/${encodeURIComponent(sessionId)}/commands`,
      providesTags: (_result, _error, sessionId) => [{ type: "Commands", id: sessionId }]
    }),
    executeCommand: builder.mutation<CommandExecutionResult, { sessionId: string; requestId: string; commandId: string; argument?: string; file?: { name: string; content: string } }>({
      query: ({ sessionId, ...body }) => ({ url: `/sessions/${encodeURIComponent(sessionId)}/commands`, method: "POST", body }),
      invalidatesTags: (_result, _error, input) => [
        "Sessions",
        "Events",
        "Diagnostics",
        "Workspace",
        { type: "Commands", id: input.sessionId }
      ]
    }),
    submitRun: builder.mutation<CommandReceipt, { sessionId: string; requestId: string; text: string }>({
      query: ({ sessionId, ...body }) => ({ url: `/sessions/${encodeURIComponent(sessionId)}/runs`, method: "POST", body })
    }),
    sendControl: builder.mutation<CommandReceipt, { sessionId: string; action: "steer" | "follow-up" | "interrupt"; requestId: string; text?: string }>({
      query: ({ sessionId, action, ...body }) => ({ url: `/sessions/${encodeURIComponent(sessionId)}/controls/${action}`, method: "POST", body })
    }),
    getDiagnostics: builder.query<DiagnosticSnapshot, void>({
      query: () => "/diagnostics",
      providesTags: ["Diagnostics"]
    }),
    getAcceptanceRecords: builder.query<{ records: AcceptanceRecord[] }, void>({
      query: () => "/acceptance-records",
      providesTags: ["Acceptance"]
    }),
    getAcceptanceRecord: builder.query<AcceptanceRecord, string>({
      query: (id) => `/acceptance-records/${encodeURIComponent(id)}`,
      providesTags: (_result, _error, id) => [{ type: "Acceptance", id }]
    })
  })
});

export const {
  useHealthQuery,
  useProbeRuntimeMutation,
  useSelectRuntimeMutation,
  useGetModelQuery,
  useGetModelSourcesQuery,
  useSelectWorkspaceMutation,
  usePickWorkspaceMutation,
  useImportWorkspaceMutation,
  useCreateAcceptanceWorkspaceMutation,
  useCreateStarterWorkspaceMutation,
  useSetWorkspaceTrustMutation,
  useGetWorkspaceQuery,
  useGetFileViewQuery,
  useGetFilePreviewQuery,
  useGetSessionsQuery,
  useCreateSessionMutation,
  useOpenSessionMutation,
  useCloseSessionMutation,
  useDeleteSessionMutation,
  useRenameSessionMutation,
  useGetForkPointsQuery,
  useLazyGetForkPointsQuery,
  useForkSessionMutation,
  useGetEventsQuery,
  useGetCommandsQuery,
  useExecuteCommandMutation,
  useSubmitRunMutation,
  useSendControlMutation,
  useGetDiagnosticsQuery,
  useGetAcceptanceRecordsQuery,
  useGetAcceptanceRecordQuery
} = bridgeApi;
