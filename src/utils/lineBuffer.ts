export class LineBuffer {
  private buffer = "";

  push(chunk: Buffer | string): string[] {
    this.buffer += chunk.toString();
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    return lines;
  }

  flush(): string | undefined {
    const remaining = this.buffer;
    this.buffer = "";
    return remaining.length > 0 ? remaining : undefined;
  }
}
