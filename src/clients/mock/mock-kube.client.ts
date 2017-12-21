import { Observable } from "rxjs/Observable";
import { KubeClient } from "../kube.client";

export class MockKubeClient extends KubeClient {

  public static get(uri: string, watch: boolean = false): RequestMockBuilder {
    return new MockKubeClientBuilder().get(uri, watch);
  }

  public static post(uri: string, watch: boolean = false): RequestMockBuilder {
    return new MockKubeClientBuilder().post(uri, watch);
  }

  public static put(uri: string, watch: boolean = false): RequestMockBuilder {
    return new MockKubeClientBuilder().put(uri, watch);
  }

  public static delete(uri: string, watch: boolean = false): RequestMockBuilder {
    return new MockKubeClientBuilder().delete(uri, watch);
  }

  public static patch(uri: string, watch: boolean = false): RequestMockBuilder {
    return new MockKubeClientBuilder().delete(uri, watch);
  }

  public static build(): MockKubeClient {
    return new MockKubeClient([]);
  }

  private requestBodyHistory: { [key: string]: any } = {};

  constructor(private requestMocks: RequestMock[]) {
    super();
  }

  public request<T>(method: string, uri: string, options?: { watch?: boolean, body?: any }): Observable<T> {
    return Observable.create(observer => {
      let matchRequests = this.requestMocks.filter(
        mock => mock.method.toLowerCase() === method.toLowerCase() && mock.uri === uri);
      if (matchRequests.length === 0) {
        observer.error(`No mock for ${method} ${uri}`);
      } else if (matchRequests.length > 1) {
        observer.error(`${matchRequests.length} mocks for ${method} ${uri}`);
      } else {
        let requestMock = matchRequests[0];
        this.requestBodyHistory[method + " " + uri] = options && options.body ? options.body : {};
        if (requestMock.body) {
          observer.next(requestMock.body);
          observer.complete();
        } else {
          observer.error(requestMock.error || `No response mock for ${method} ${uri}`);
        }
      }
    });
  }

  public bodyOf(method: string, uri: string): any {
    return this.requestBodyHistory[method + " " + uri];
  }

}

export class MockKubeClientBuilder {

  private requestMocks: RequestMockBuilder[] = [];

  public get(uri: string, watch: boolean = false): RequestMockBuilder {
    let requestBuilder = new RequestMockBuilder(this, "get", uri, watch);
    this.requestMocks.push(requestBuilder);
    return requestBuilder;
  }

  public post(uri: string, watch: boolean = false): RequestMockBuilder {
    let requestBuilder = new RequestMockBuilder(this, "post", uri, watch);
    this.requestMocks.push(requestBuilder);
    return requestBuilder;
  }

  public put(uri: string, watch: boolean = false): RequestMockBuilder {
    let requestBuilder = new RequestMockBuilder(this, "put", uri, watch);
    this.requestMocks.push(requestBuilder);
    return requestBuilder;
  }

  public patch(uri: string, watch: boolean = false): RequestMockBuilder {
    let requestBuilder = new RequestMockBuilder(this, "patch", uri, watch);
    this.requestMocks.push(requestBuilder);
    return requestBuilder;
  }

  public delete(uri: string, watch: boolean = false): RequestMockBuilder {
    let requestBuilder = new RequestMockBuilder(this, "delete", uri, watch);
    this.requestMocks.push(requestBuilder);
    return requestBuilder;
  }

  public build(): MockKubeClient {
    return new MockKubeClient(this.requestMocks.map(requestMock => requestMock.build()));
  }

}

export class RequestMockBuilder {

  private requestMock: RequestMock;

  constructor(private mockKubeClientBuilder: MockKubeClientBuilder, method: string, uri: string,
              watch: boolean = false) {
    this.requestMock = {
      watch,
      method,
      uri
    };
  }

  public responseError(error: any): MockKubeClientBuilder {
    this.requestMock.error = error;
    return this.mockKubeClientBuilder;
  }

  public responseBody(body: any): MockKubeClientBuilder {
    this.requestMock.body = body;
    return this.mockKubeClientBuilder;
  }

  public build(): RequestMock {
    return this.requestMock;
  }

}

export interface RequestMock {

  watch: boolean;
  method: string;
  uri: string;
  body?: any;
  error?: any;

}
