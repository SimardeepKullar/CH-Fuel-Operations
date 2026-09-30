// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dropzone from "./Dropzone";

afterEach(cleanup);

function makeFile(name: string, content = "x"): File {
  return new File([content], name);
}

describe("Dropzone (T-42 step 42.1)", () => {
  it("accepts a dropped CSV file", () => {
    const onFile = vi.fn();
    render(<Dropzone onFile={onFile} />);
    const file = makeFile("invoice_100001.csv");
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("accepts a dropped PDF file", () => {
    const onFile = vi.fn();
    render(<Dropzone onFile={onFile} />);
    const file = makeFile("BVD_invoice_999210.pdf");
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("refuses a non-CSV/PDF drop before any upload — no call to onFile", () => {
    const onFile = vi.fn();
    render(<Dropzone onFile={onFile} />);
    const file = makeFile("notes.txt");
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [file] } });
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByTestId("dropzone-rejection").textContent).toContain("notes.txt");
  });

  it("accepts a file chosen via the file-picker fallback", () => {
    const onFile = vi.fn();
    render(<Dropzone onFile={onFile} />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    const file = makeFile("invoice_100001.csv");
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("a later valid drop clears a prior rejection message", () => {
    const onFile = vi.fn();
    render(<Dropzone onFile={onFile} />);
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [makeFile("notes.txt")] } });
    expect(screen.getByTestId("dropzone-rejection")).toBeTruthy();

    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [makeFile("invoice_100001.csv")] } });
    expect(screen.queryByTestId("dropzone-rejection")).toBeNull();
    expect(onFile).toHaveBeenCalledTimes(1);
  });
});
