export type Volume = {
  id: string; // unique filesystem-backed identity
  series: string; // Detective Conan
  title: string;
  uri: string; // content:// or file:// to folder
  progressKey?: string; // distinct identity when several files share one folder
  htmlUri?: string; // .../Meitantei Konan 001.mobile.html
  mokuroUri?: string; // .../Meitantei Konan 001.mokuro
  ocrUri?: string; // .../_ocr/Meitantei Konan 096
  pageCount: number;
  coverUri?: string; // .../page0001.jpeg or cover.jpeg
  lastOpened?: number;
  progress?: number; // 0-1
};

export type Series = {
  name: string; // Detective Conan
  rootUri: string; // content://.../Detective Conan
  sourceRootUri?: string; // parent shelf selected by the user
  volumes: Volume[];
  totalPages: number;
};
