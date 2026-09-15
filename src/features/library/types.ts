export type Volume = {
  id: string; // Meitantei Konan 096
  series: string; // Detective Conan
  title: string;
  uri: string; // content:// or file:// to folder
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
  volumes: Volume[];
  totalPages: number;
};
