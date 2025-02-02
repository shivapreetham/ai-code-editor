"use client";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import React, { useContext, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import "./page.css";
import { initSocket } from "@/socket";
import { ACTIONS } from "@/app/helpers/Actions";
import toast, { Toaster } from "react-hot-toast";
import { Socket } from "socket.io-client";
import PeopleAltIcon from "@mui/icons-material/PeopleAlt";
import SourceIcon from "@mui/icons-material/Source";
import Peoples from "@/app/components/Peoples";
import ChatIcon from '@mui/icons-material/Chat';
import SettingsIcon from '@mui/icons-material/Settings';
import FileExplorer from "@/app/components/fileExplorer/FileExplorer";
import CloseIcon from "@mui/icons-material/Close";
import { IFileExplorerNode } from "@/interfaces/IFileExplorerNode";
import { IFile } from "@/interfaces/IFile";
import { IDataPayload } from "@/interfaces/IDataPayload";
import { v4 as uuid } from "uuid";
import axios, { AxiosError } from "axios";
import Loading from "@/app/components/loading/Loading";
import Chat, { Message } from "@/app/components/chat/Chat";
import { ChatContext } from "@/context/ChatContext";
import { useDebounceCallback } from 'usehooks-ts';
import { workspaceApi } from "@/services/workspaceApi";
import { useAISuggestions } from "@/hooks/useAISuggestion";
import AiSuggestionSidebar from "@/app/components/aiSidebar/AiSidebar";
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ThemeSwitcher from "@/app/components/theme/ThemeComp";
import { ThemeContext } from "@/context/ThemeContext";
import { FontSizeContext } from "@/context/FontSizeContext";
import { useSession } from "next-auth/react";


const filesContentMap = new Map<string, IFile>();

const DEFAULT_FILE = {
  name: "index.js",
  language: "javascript",
  content: `console.log(\`You are awesome 🤟\`)`,
  path: "/root/index.js",
};

const DEFAULT_EXPLORER = {
  id: uuid(),
  name: "root",
  isFolder: true,
  path: "/root",
  nodes: [
    {
      id: uuid(),
      name: "index.js",
      isFolder: false,
      nodes: [],
      path: "/root/index.js",
    },
  ],
};

const Page = () => {
  const params = useParams();
  const query = useSearchParams();
  const username= query.get("username");
  const router = useRouter();
  const { messages, setMessages } = useContext(ChatContext);
  const {theme, setTheme} = useContext(ThemeContext);
  const {fontSize, setFontSize} = useContext(FontSizeContext);

  const { roomId } = params;

  const [clients, setClients] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  const [activeFile, setActiveFile] = useState<IFile>({ name: "", content: "", language: "", path: "" });
  const [files, setFiles] = useState<IFile[]>([]);

  const [fileExplorerData, setFileExplorerData] = useState<IFileExplorerNode>(DEFAULT_EXPLORER);
  const [isFileExplorerUpdated, setIsFileExplorerUpdated] = useState(false);
  const [isOutputExpand, setIsOutputExpand] = useState(false);
  const [loading, setLoading] = useState(false);
  const [codeOutput, setCodeOutput] = useState("");
  const [codeStatus, setCodeStatus] = useState("");

  const editorRef = useRef(null);
  const socketRef = useRef<Socket | null>(null);

  const { isLoading: aiLoading, aiResponse, fetchSuggestions } = useAISuggestions({
    enabled: activeTab === 4
  });
  
  const {data:session, status} = useSession();

  useEffect(()=>{
    if(status==='unauthenticated')
      router.push('/login')
  },[status])

  const debouncedSaveAndEmit = useDebounceCallback(
    (content: string, socketRef: any, roomId: string | string[], activeFile: IFile, fileExplorerData: IFileExplorerNode, files: IFile[]) => {
      const updatedActiveFile = {
        ...activeFile,
        content: content,
      };
    
      filesContentMap.set(activeFile.path, updatedActiveFile);
      const dataPayload: IDataPayload = {
        fileExplorerData,
        openFiles: files,
        activeFile: updatedActiveFile,
      };
      
      // Save workspace
      workspaceApi.saveWorkspace(roomId as string, dataPayload, filesContentMap)
        .catch(error => console.error('Error saving workspace:', error));
    
      // Emit changes
      socketRef.current?.emit(ACTIONS.CODE_CHANGE, {
        roomId,
        payload: dataPayload,
      });
  
      // Fetch AI suggestions if enabled
      fetchSuggestions(content, activeFile.language);
    },
    1500
  );

function handleEditorChange(content: string | undefined) {
  if (content === undefined) return;
  debouncedSaveAndEmit(
    content,
    socketRef,
    roomId,
    activeFile,
    fileExplorerData,
    files
  );
}
  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        setLoading(true);
        const workspace = await workspaceApi.getWorkspace(roomId as string);
        
        if (workspace && workspace.filesContentMap) {
          setFileExplorerData(workspace.fileExplorerData);
          setFiles(workspace.openFiles);
          setActiveFile(workspace.activeFile);
          
          // Clear and update filesContentMap
          filesContentMap.clear();
          workspace.filesContentMap.forEach((file : IFile, path: string) => {
            filesContentMap.set(path, file);
          });
        } else {
          // Set defaults for new workspace
          setFileExplorerData(DEFAULT_EXPLORER);
          setFiles([DEFAULT_FILE]);
          setActiveFile(DEFAULT_FILE);
          filesContentMap.set(DEFAULT_FILE.path, DEFAULT_FILE);
        }
      } catch (error) {
        console.error('Error loading workspace:', error);
        // Set defaults on error
        setFileExplorerData(DEFAULT_EXPLORER);
        setFiles([DEFAULT_FILE]);
        setActiveFile(DEFAULT_FILE);
        filesContentMap.set(DEFAULT_FILE.path, DEFAULT_FILE);
      } finally {
        setLoading(false);
      }
    };

    if (roomId) {
      loadWorkspace();
    }
  }, [roomId]);

  useEffect(() => {
    if (isFileExplorerUpdated && socketRef.current) {
      const dataPayload: IDataPayload = {
        fileExplorerData,
        openFiles: files,
        activeFile,
      };
      
      // Save to backend
      workspaceApi.saveWorkspace(roomId as string, dataPayload, filesContentMap)
        .catch(error => console.error('Error saving workspace:', error));

      // Emit to other clients
      socketRef.current.emit(ACTIONS.CODE_CHANGE, {
        roomId,
        payload: dataPayload,
      });
      
      setIsFileExplorerUpdated(false);
    }
  }, [isFileExplorerUpdated, fileExplorerData, files, activeFile, roomId]);


  function handleEditorDidMount(editor: any, monaco: any) {
    editorRef.current = editor;
  }

  const handleSocketErrors = (err: any) => {
    console.log("Socket error: ", err);
  };

  const handleLeaveRoom = () => {
    router.replace("/");
  };

  const handleTabChange = (tabId: number) => {
    setActiveTab(tabId);
  };

  const handleCloseFile = (e: React.MouseEvent, file: IFile) => {
    e.stopPropagation();
    const updatedOpenFiles = files.filter(
      (currentFile) => currentFile.path !== file.path
    );
    const updatedActiveFile =
      updatedOpenFiles.length > 0
        ? updatedOpenFiles[0]
        : {
            name: "",
            content: "",
            language: "",
            path: "",
          };
    setActiveFile(updatedActiveFile);
    setFiles(updatedOpenFiles);
    const dataPayload: IDataPayload = {
      fileExplorerData,
      openFiles: updatedOpenFiles,
      activeFile: updatedActiveFile,
    };
    socketRef.current!.emit(ACTIONS.CODE_CHANGE, {
      roomId,
      payload: dataPayload,
    });
  };

  const handleChangeActiveFile = (file: IFile) => {
    setActiveFile(file);
  };

  const handleToggleOutputVisibility = () => {
    setIsOutputExpand(!isOutputExpand);
  };

  const handleSendCodeOutputData = ({
    status,
    output,
  }: {
    status: string;
    output: string;
  }) => {
    const dataPayload: IDataPayload = {
      fileExplorerData,
      openFiles: files,
      activeFile,
      codeOutputData: {
        status,
        output,
      },
    };

    socketRef.current!.emit(ACTIONS.CODE_CHANGE, {
      roomId,
      payload: dataPayload,
    });
  };

  const handleCodeStatus = async (
    jobId: string,
    intervalId: NodeJS.Timeout
  ) => {
    try {
      console.log("calling for status")
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/code/status/${jobId}`
      );
      console.log("called for status")
      if (response.status === 200) {
        const status = response.data.job.status;
        setCodeStatus(response.data.job.status);
        handleSendCodeOutputData({ status, output: "" });
        if (response.data.job.status === "success") {
          const output = response.data.job.output;
          setCodeOutput(output);
          setIsOutputExpand(true);
          setLoading(false);
          clearInterval(intervalId);
          handleSendCodeOutputData({ status, output });
        } else if (response.data.job.status === "failed") {
          const output =
            "[Error]: " + JSON.parse(response.data.job.output).stderr;
          setCodeOutput(output);
          setIsOutputExpand(true);
          setLoading(false);
          clearInterval(intervalId);
          handleSendCodeOutputData({ status, output });
        }
      }
    } catch (error) {
      console.log(error);
      setLoading(false);
      clearInterval(intervalId);
      alert(error);
    }
  };

  const handleRunCode = async () => {
    const data = {
      code: filesContentMap.get(activeFile.path)?.content,
      language: activeFile.language,
      extension: activeFile.name.split(".")[1],
    };

    if (!["cpp", "py", "js"].includes(data.extension)) {
      toast.error(
        `Unsupported programming language (${data.language}). Supported languages are C++, Python, and JavaScript.`
      );
      return;
    }

    setCodeStatus("");
    try {
      setLoading(true);
      handleSendCodeOutputData({ status: "loading", output: "" });
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/code/execute`,
        data,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      if (response.status === 201) {
        const intervalId = setInterval(async () => {
          await handleCodeStatus(response.data.jobId, intervalId);
        }, 500);
      }
    } catch (error) {
      console.log(error);
      if ((error as AxiosError).status === 503) {
        toast.error("Service is temporarily unavailable!");
      } else {
        toast.error("Internal server error!");
      }
      setLoading(false);
    }
  };

  useEffect(() => {
    const usernameFromUrl = query.get("username");
    const toastId = query.get("toastId");
    toast.dismiss(toastId!);

    const init = async () => {
      socketRef.current = await initSocket();

      socketRef.current.on("connect_error", (err: any) =>
        handleSocketErrors(err)
      );
      socketRef.current.on("connect_failed", (err: any) =>
        handleSocketErrors(err)
      );

      socketRef.current.emit(ACTIONS.JOIN, {
        roomId,
        username: usernameFromUrl,
      });

      socketRef.current.on(ACTIONS.JOINED, ({ clients, username }) => {
        if (username !== usernameFromUrl) {
          toast.success(`${username} joined the room.`);
        }
        setClients(clients);
      });

      socketRef.current.on(ACTIONS.LOAD_MESSAGES, (chatHistory: Message[]) => {
        console.log("Loaded messages from server:", chatHistory);
        setMessages(chatHistory); // Update chat history from server
      });

      socketRef.current.on(
        ACTIONS.DISCONNECTED,
        ({ username, socketId }: { username: string; socketId: string }) => {
          toast.success(`${username} left the room.`);
          setClients((prev: any) => {
            return prev.filter((client: any) => client.socketId !== socketId);
          });
        }
      );

      socketRef.current.on(
        ACTIONS.CODE_CHANGE,
        ({ payload }: { payload: IDataPayload }) => {
          console.log("WS: ", payload);
          if (payload.codeOutputData) {
            setCodeOutput(payload.codeOutputData.output);
            setCodeStatus(payload.codeOutputData.status);
            setLoading(
              ["loading", "pending"].includes(payload.codeOutputData.status)
            );
            ["success", "failed"].includes(payload.codeOutputData.status) &&
              setIsOutputExpand(true);
          } else {
            setActiveFile(payload.activeFile);
            setFileExplorerData(payload.fileExplorerData);
            setFiles(payload.openFiles);
            filesContentMap.set(payload.activeFile.path, payload.activeFile);
          }
        }
      );
    };

    usernameFromUrl ? init() : handleLeaveRoom();

    return () => {
      if (socketRef.current) {
        socketRef.current.off(ACTIONS.JOINED);
        socketRef.current.off(ACTIONS.DISCONNECTED);
        socketRef.current.off(ACTIONS.CODE_CHANGE);
        socketRef.current.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isFileExplorerUpdated && socketRef.current) {
      const dataPayload: IDataPayload = {
        fileExplorerData,
        openFiles: files,
        activeFile,
      };
      socketRef.current!.emit(ACTIONS.CODE_CHANGE, {
        roomId,
        payload: dataPayload,
      });
      setIsFileExplorerUpdated(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFileExplorerUpdated]);

  return (
    <div className="flex flex-col md:flex-row">
      <Toaster />
      <div className="hidden md:w-[4.5%] md:h-screen bg-[#2d2a2a] border-r border-r-[#4e4b4b] py-5 md:flex flex-col items-center gap-3">
        <SourceIcon
          onClick={() => handleTabChange(0)}
          sx={{
            cursor: "pointer",
            fontSize: "2rem",
            color: activeTab === 0 ? "#ffe200" : "#8c7f91",
            "&:hover": { color: "#ffe200" },
          }}
        />
        <PeopleAltIcon
          onClick={() => handleTabChange(1)}
          sx={{
            cursor: "pointer",
            fontSize: "2rem",
            color: activeTab === 1 ? "#ffe200" : "#8c7f91",
            "&:hover": { color: "#ffe200" },
          }}
        />

        <ChatIcon
          onClick={() => handleTabChange(2)}
          sx={{
            cursor: "pointer",
            fontSize: "2rem",
            color: activeTab === 2 ? "#ffe200" : "#8c7f91",
            "&:hover": { color: "#ffe200" },
          }}
        />
         <SettingsIcon
          onClick={() => handleTabChange(3)}
          sx={{
            cursor: "pointer",
            fontSize: "2rem",
            color: activeTab === 3 ? "#ffe200" : "#8c7f91",
            "&:hover": { color: "#ffe200" },
          }}
        />
        <AutoFixHighIcon
          onClick={() => handleTabChange(4)}
          sx={{
            cursor: "pointer",
            fontSize: "2rem",
            color: activeTab === 4 ? "#ffe200" : "#8c7f91",
            "&:hover": { color: "#ffe200" },
          }}
        />
      </div>
      <div className="w-full md:w-[30%] lg:w-[30%] md:h-screen bg-[#right] border-r border-r-[#605c5c]">
      {activeTab === 0 && (
          <FileExplorer
            fileExplorerData={fileExplorerData}
            setFileExplorerData={setFileExplorerData}
            activeFile={activeFile}
            setActiveFile={setActiveFile}
            files={files}
            setFiles={setFiles}
            isFileExplorerUpdated={isFileExplorerUpdated}
            setIsFileExplorerUpdated={setIsFileExplorerUpdated}
            roomId={roomId as string}
            filesContentMap={filesContentMap}
          />
        )}
        {activeTab === 1 && (
          <Peoples clients={clients} roomId={roomId as string} />
        )}
        {activeTab === 2 && username && roomId && (
          <Chat socket={socketRef.current} username={username} roomId={roomId as string} />
        )}
        {activeTab === 3 && (
          <ThemeSwitcher />
        )}
        {activeTab === 4 && (
          <AiSuggestionSidebar
            isOpen={true}
            aiResponse={aiResponse}
            isLoading={aiLoading}
          />
        )}
      </div>
      <div className="coegle_editor w-full md:w-[70%] h-screen">
        <div className="h-[5vh] w-full flex overflow-y-auto mb-2">
          {files.map((file, index) => {
            return (
              <div
                onClick={() => handleChangeActiveFile(file)}
                key={file.path + index}
                className={
                  "cursor-pointer flex gap-2 items-center px-3 py-1 text-sm " +
                  (activeFile.path === file.path
                    ? "text-[#fec76f] bg-[#473e3e]"
                    : "text-[#aaaaaa] bg-[#473e3e]")
                }
              >
                <span>{file.name}</span>
                <CloseIcon
                  onClick={(e) => handleCloseFile(e, file)}
                  className="cursor-pointer"
                  sx={{ fontSize: "14px" }}
                />
              </div>
            );
          })}
        </div>
        {activeFile.name && files.length > 0 ? (
          <div className="h-[93vh]">
            <Editor
              height={isOutputExpand ? "60%" : "86%"}
              path={activeFile.name}
              defaultLanguage={activeFile.language}
              defaultValue={activeFile.content}
              onChange={(value) => handleEditorChange(value)}
              onMount={handleEditorDidMount}
              value={filesContentMap.get(activeFile.path)?.content}
              theme={theme}
              options={{
                minimap: {
                  enabled: false,
                },
                fontSize:fontSize,
                cursorStyle: "line",
                lineNumbersMinChars: 4,
                quickSuggestions: true,
                wordWrap: "on", // Enables line wrapping
                wrappingStrategy: "advanced",
              }}
              loading={<Loading status="Initializing..." color="#f29221" />}
            />
            <div className={isOutputExpand ? "h-[40%]" : "h-[10%]"}>
              <div className="bg-[#252522] border-t rounded-sm border-[#aaaaaa50]">
                <div
                  onClick={handleToggleOutputVisibility}
                  className="bg-[#1e1e1e] cursor-pointer flex items-center justify-between bg-transparent text-[#f29221] px-4 py-2 font-semibold"
                >
                  <span>Output</span>
                  <span>
                    <svg
                      className={
                        "w-3 h-3 shrink-0 " +
                        (isOutputExpand ? "rotate-180" : "rotate-0")
                      }
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 10 6"
                    >
                      <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 5 5 1 1 5"
                      />
                    </svg>
                  </span>
                </div>
                {isOutputExpand && (
                  <textarea
                    value={codeOutput}
                    readOnly
                    className="px-5 py-2 w-full h-[160px] outline-none bg-[#252522] text-white overflow-auto resize-none"
                  />
                )}
              </div>
              <div className="flex justify-end items-center px-5 py-2 border-t border-t-[#aaaaaa50]">
                <button
                  type="button"
                  onClick={handleRunCode}
                  className="py-2 px-10 inline-flex items-center gap-x-2 text-sm font-medium rounded-lg border border-transparent bg-[#fec76f] hover:bg-[#fec76fe6] text-[#000]"
                  id="hs-basic-collapse"
                  aria-expanded="false"
                  aria-controls="hs-basic-collapse-heading"
                  data-hs-collapse="#hs-basic-collapse-heading"
                  disabled={loading}
                >
                  {loading ? <Loading status={codeStatus} /> : "Run"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xl text-[#aaaaaa] flex items-center justify-center h-[93vh]">
            No file is open.
          </div>
        )}
      </div>
    </div>
  );
};

export default Page;
