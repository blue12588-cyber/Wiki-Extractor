<!--
  UsageTab.svelte — 사용법 (Slice 6 · AC-USAGE-TAB + AC-KOREAN-UI)
  ---------------------------------------------------------------
  로그인-피드백 사이에 놓이는 사용법 탭. 대상은 AI·IT를 잘 모르는 일반인(20-40대).
  네 단계(원서 넣기 → 후보 자동 추출 → ChatGPT로 정리 → 위키 검토·저장)를
  친근한 한글로 안내한다. 전문용어·내부 jargon은 최소화하고, 꼭 필요한 곳에만
  쉬운 풀이를 붙인다.

  설계: 단계마다 큰 번호 + 짧은 제목 + 한두 문장 설명. 색상에만 의존하지 않도록
  번호 원형은 텍스트(①②③④) + 테두리로 구분된다(접근성). 토큰만 사용한다.

  이 탭은 어떤 인증도 필요 없고, 어떤 데이터도 바꾸지 않는다(읽기 전용 안내).
-->
<script lang="ts">
  // 순수 안내 화면 — 상태/네트워크/저장 없음.
  const steps = [
    {
      n: '①',
      title: '먼저 “목차(스키마)”를 입력하기',
      body:
        '무엇보다 먼저, 정리할 책·자료의 목차나 큰 항목 틀(스키마)을 [메인] 화면에 입력해 주세요. 예를 들어 “1장 서론 / 2장 배경 / 3장 핵심 주장 …”처럼요. 목차를 먼저 정해 두면, 다음 단계에서 뽑은 후보들이 그 목차에 맞춰 분류되어 훨씬 정돈된 위키가 됩니다. (목차 없이도 쓸 수 있지만, 먼저 넣는 편을 권합니다.)',
    },
    {
      n: '②',
      title: '원서(읽을 책·자료)를 넣기',
      body:
        '정리하고 싶은 책이나 자료 파일을 [메인] 화면으로 끌어다 놓거나, [파일 선택]으로 고릅니다. PDF, 일반 텍스트(.txt), 마크다운(.md) 파일을 넣을 수 있어요. 파일은 내 컴퓨터 안에서만 다뤄집니다.',
    },
    {
      n: '③',
      title: '후보를 자동으로 뽑기 (목차 기준으로 분류)',
      body:
        '파일을 넣으면 앱이 긴 내용을 읽기 좋은 크기로 잘게 나눠, 위키로 만들 만한 “후보”(중요한 개념·주장·인물 등)를 스스로 찾아 카드로 보여 줍니다. ①에서 넣은 목차가 있으면 후보들이 그 목차 항목에 맞춰 분류됩니다. 이 단계는 인터넷 없이도 동작합니다.',
    },
    {
      n: '④',
      title: 'ChatGPT로 정리하기 (두 가지 방법)',
      body: null, // 이 단계는 아래 두 갈래로 나눠 설명
    },
    {
      n: '⑤',
      title: '위키를 검토하고 저장하기',
      body:
        '정리된 후보 카드를 하나씩 보면서 [승인]·[보류]·[폐기]를 고릅니다. 내용이 마음에 안 들면 직접 고쳐 쓸 수도 있어요. 승인한 항목만 내 위키에 저장되고, 나중에 [위키] 화면에서 다시 보고 편집할 수 있습니다.',
    },
  ];
</script>

<section class="usage">
  <header class="intro">
    <h2 class="section-title">사용법 — 처음 쓰는 분께</h2>
    <p class="section-lede">
      이 앱은 읽은 책·자료에서 중요한 내용을 뽑아 나만의 “위키”(쉽게 말해, 정리된
      메모 모음)로 만들어 줍니다. 아래 다섯 단계만 따라 하면 됩니다. 어려운 설정이나
      가입은 필요 없어요.
    </p>

    <!-- AC-USAGE-OUTLINE-FIRST: 목차/스키마를 먼저 입력하라는 안내를 눈에 띄게. -->
    <p class="outline-first" role="note">
      <strong>가장 먼저 “목차(스키마)”를 입력하세요.</strong>
      정리할 책·자료의 목차나 큰 틀을 [메인] 화면에 먼저 넣어 두면, 뒤에서 뽑은
      내용이 그 목차에 맞춰 분류되어 훨씬 깔끔한 위키가 됩니다. 순서는 아래와 같아요:
      <span class="outline-flow">목차 입력 → 원서 넣기 → 후보 추출 → ChatGPT 정리 → 위키 검토·저장</span>
    </p>
  </header>

  <ol class="step-list" role="list">
    {#each steps as step (step.n)}
      <li class="step">
        <span class="step-num" aria-hidden="true">{step.n}</span>
        <div class="step-text">
          <h3 class="step-title">{step.title}</h3>
          {#if step.body}
            <p class="step-body">{step.body}</p>
          {:else}
            <!-- ③ 단계: 복붙 방식(기본) / 자동 방식(로그인 시) 두 갈래 -->
            <p class="step-body">
              뽑은 후보를 더 깔끔하게 다듬으려면 ChatGPT의 도움을 받습니다.
              방법은 두 가지이고, <strong>어느 쪽이든 결과는 같습니다.</strong>
            </p>

            <div class="branch" data-kind="paste">
              <h4 class="branch-title">방법 A · 복사해서 붙여넣기 <span class="branch-tag">기본 · 누구나</span></h4>
              <ol class="branch-steps" role="list">
                <li>[ChatGPT 프롬프트 복사] 버튼을 누르면 보낼 내용이 통째로 복사됩니다.</li>
                <li>웹브라우저에서 <code>chatgpt.com</code>에 들어가 빈칸에 그대로 붙여넣고 보냅니다.</li>
                <li>ChatGPT가 답한 내용을 다시 복사해서, 앱의 입력칸에 붙여넣습니다.</li>
              </ol>
              <p class="branch-note">
                가입·로그인 외에 따로 설치할 것이 없어, 누구나 바로 쓸 수 있는
                기본 방법입니다.
              </p>
            </div>

            <div class="branch" data-kind="auto">
              <h4 class="branch-title">방법 B · 자동으로 처리 <span class="branch-tag">선택 · 로그인하면</span></h4>
              <p class="branch-note">
                [로그인] 화면에서 <strong>[ChatGPT로 로그인]</strong> 버튼을 눌러
                내 ChatGPT 계정으로 한 번 로그인해 두면, 위 복사·붙여넣기 과정을
                앱이 알아서 대신 해 줍니다. 버튼을 누르면 앱이 먼저 로그인 상태를
                확인하고, <strong>이미 로그인돼 있으면</strong> 브라우저를 열지 않고
                바로 자동 모드를 켭니다(정상이에요). 아직 로그인 전이면 로그인
                페이지를 자동으로 열고 <strong>짧은 코드</strong>를 화면에 크게 보여
                주니, 그 코드를 브라우저에 입력하면 됩니다. 아이디·비밀번호는 앱에
                입력하지 않습니다.
              </p>
              <p class="branch-note">
                로그인 페이지가 자동으로 열리지 않는 환경(회사·학교 방화벽, 원격 접속
                등)에서도, 화면에 뜬 주소 옆 <strong>[주소 열기]</strong> 버튼이나
                주소를 직접 입력해 로그인을 마칠 수 있습니다. 코드 입력 방식이 막힌
                드문 경우에는 <strong>[브라우저 자동 열기 방식으로 다시 시도]</strong>를
                눌러 보세요.
              </p>
              <p class="branch-note muted">
                이 방법은 선택 사항이에요. 로그인하지 않아도 <strong>방법 A</strong>로
                모든 기능을 똑같이 쓸 수 있습니다.
              </p>
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ol>

  <!-- AC-USAGE-AUTO-SETUP (Slice 9): 자동 모드를 쓰고 싶은 사람을 위한 1회 설정법.
       기본 복붙(방법 A)과 분리된 별도의 '고급' 섹션이다. 일반인도 따라 할 수 있게
       PowerShell 명령을 그대로 적어 둔다. codex 설치·로그인은 사용자가 직접 한다
       (앱은 검출·안내만; 강요하지 않음). -->
  <section class="auto-setup" aria-labelledby="auto-setup-title">
    <h3 id="auto-setup-title" class="auto-setup-title">
      자동 모드 설정법 <span class="auto-setup-tag">고급 · 선택</span>
    </h3>
    <p class="auto-setup-lede">
      위 <strong>방법 A(복사·붙여넣기)</strong>만으로도 모든 기능을 그대로 쓸 수
      있습니다. 매번 복사·붙여넣기 하기가 번거롭다면, 아래 설정을
      <strong>한 번만</strong> 해 두면 앱이 알아서 ChatGPT에게 물어보고 결과를
      받아오는 <strong>자동 모드</strong>를 켤 수 있어요. 내 ChatGPT 계정(무료 또는
      구독)으로 동작하며, 사용량도 내 계정 기준입니다. 처음 쓰는 분께는 꼭 필요한
      과정은 아니니, 자동이 필요할 때 시도해 보세요.
    </p>

    <ol class="auto-steps" role="list">
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">1</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">PowerShell(파워셸) 열기</h4>
          <p class="auto-step-body">
            윈도우 시작 메뉴에서 <strong>“PowerShell”</strong>을 검색해 엽니다.
            검은(또는 파란) 명령 입력 창이 뜨면 준비된 거예요.
          </p>
        </div>
      </li>
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">2</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">codex(코덱스) 설치하기</h4>
          <p class="auto-step-body">
            아래 한 줄을 그대로 입력하고 <kbd>Enter</kbd>를 누르면 설치됩니다.
            (Node.js가 미리 설치돼 있어야 합니다.)
          </p>
          <pre class="auto-cmd"><code>npm i -g &#64;openai/codex</code></pre>
        </div>
      </li>
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">3</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">내 ChatGPT 계정으로 로그인하기</h4>
          <p class="auto-step-body">
            이어서 아래를 입력하고 <kbd>Enter</kbd>를 누릅니다. 웹브라우저가 열리며
            <strong>ChatGPT 로그인 화면</strong>이 나오면, 평소 쓰던 ChatGPT 계정으로
            로그인하면 됩니다(무료/구독 계정 모두 가능). 아이디·비밀번호는 이 앱에
            입력하지 않습니다 — 로그인은 ChatGPT 공식 페이지에서만 이루어집니다.
          </p>
          <pre class="auto-cmd"><code>codex login</code></pre>
        </div>
      </li>
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">4</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">앱에서 자동 모드 켜기</h4>
          <p class="auto-step-body">
            한 번 로그인해 두면 이 앱이 자동으로 인식합니다. 앱의 [로그인] 화면에서
            <strong>[다시 검출]</strong>을 누르면 “자동 모드 사용 가능”으로 바뀌고,
            [추출 모드]에서 <strong>자동 LLM 모드</strong>를 고를 수 있게 됩니다. 이
            한 번의 설정 뒤로는 복사·붙여넣기 없이 바로 자동으로 정리돼요.
          </p>
        </div>
      </li>
    </ol>

    <p class="auto-setup-note" role="note">
      codex는 자동 모드가 동작하는 동안 백그라운드에서 내 계정 인증을 이어 주는
      도우미예요. 한 번 설치·로그인해 두면 계속 쓸 수 있고, 컴퓨터에 그대로 두면
      됩니다. 자동 모드가 잘 안 되거나 설치가 어려우면 언제든
      <strong>방법 A(복붙)</strong>로 똑같이 모든 기능을 쓸 수 있으니 걱정하지 마세요.
    </p>
  </section>

  <footer class="outro" role="note">
    막히는 부분이 있으면 [피드백] 화면으로 편하게 알려 주세요. 로그인 없이 보낼 수
    있습니다.
  </footer>
</section>

<style>
  .usage {
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);
  }

  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .section-title {
    font-family: var(--heading-family);
    font-size: 1.0625rem;
    font-weight: 600;
    margin: 0;
  }

  .section-lede {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  /* AC-USAGE-OUTLINE-FIRST: 목차 먼저 안내 콜아웃. 토큰만 사용. */
  .outline-first {
    margin: var(--space-sm) 0 0 0;
    font-size: 0.875rem;
    color: var(--text-primary);
    line-height: 1.65;
    padding: var(--space-md);
    border: 1px solid var(--accent-oxblood);
    border-left: 3px solid var(--accent-oxblood);
    border-radius: var(--radius-soft);
    background: var(--surface-elevated);
  }
  .outline-flow {
    display: block;
    margin-top: var(--space-xs);
    font-family: var(--heading-family);
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--accent-oxblood);
  }

  .step-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .step {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-md);
    align-items: start;
    padding: var(--space-lg);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--accent-oxblood);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-elevated);
  }

  .step-num {
    font-family: var(--heading-family);
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1.2;
    color: var(--accent-oxblood);
    width: 1.6em;
    text-align: center;
  }

  .step-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .step-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .step-body {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.65;
  }

  .branch {
    margin-top: var(--space-sm);
    padding: var(--space-md) var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-soft);
    background: var(--surface-sunken);
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .branch[data-kind='auto'] {
    border-style: dashed;
  }

  .branch-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }

  .branch-tag {
    font-size: 0.6875rem;
    font-weight: 700;
    padding: 1px var(--space-sm);
    border-radius: var(--radius-pill);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .branch-steps {
    margin: var(--space-xs) 0 0 0;
    padding-left: 1.3em;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .branch-note {
    margin: var(--space-xs) 0 0 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.6;
  }
  .branch-note.muted {
    color: var(--text-secondary);
    opacity: 0.9;
  }

  /* AC-USAGE-AUTO-SETUP (Slice 9): 고급 자동 모드 설정 섹션. 기본 단계와
     시각적으로 구분되도록 점선 테두리 + 별도 헤더. 토큰만 사용. */
  .auto-setup {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-lg);
    border: 1px dashed var(--accent-oxblood);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-sunken);
  }

  .auto-setup-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }

  .auto-setup-tag {
    font-size: 0.6875rem;
    font-weight: 700;
    padding: 1px var(--space-sm);
    border-radius: var(--radius-pill);
    border: 1px solid var(--accent-oxblood);
    color: var(--accent-oxblood);
  }

  .auto-setup-lede {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.65;
  }

  .auto-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .auto-step {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-md);
    align-items: start;
  }

  .auto-step-num {
    font-family: var(--heading-family);
    font-size: 1rem;
    font-weight: 700;
    line-height: 1.4;
    color: var(--accent-oxblood);
    width: 1.6em;
    height: 1.6em;
    text-align: center;
    border: 1px solid var(--accent-oxblood);
    border-radius: var(--radius-pill);
  }

  .auto-step-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .auto-step-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .auto-step-body {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .auto-cmd {
    margin: var(--space-xs) 0 0 0;
    padding: var(--space-sm) var(--space-md);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-soft);
    overflow-x: auto;
  }
  .auto-cmd code {
    background: transparent;
    padding: 0;
    font-size: 0.8125rem;
    color: var(--text-primary);
  }

  kbd {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.75em;
    padding: 0 var(--space-xs);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    background: var(--surface-base);
  }

  .auto-setup-note {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.6;
    padding: var(--space-md);
    border-left: 3px solid var(--border-subtle);
    background: var(--surface-elevated);
    border-radius: var(--radius-tight);
  }

  .outro {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.6;
    padding: var(--space-md);
    border-left: 3px solid var(--border-subtle);
    background: var(--surface-sunken);
    border-radius: var(--radius-tight);
  }

  code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--surface-base);
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
  }
</style>
